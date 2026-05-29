from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import uuid
import wave
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from translation_pipeline.config import PipelineConfig, load_pipeline_config
from translation_pipeline.runner import (
    CredentialError,
    PipelineError,
    build_stage_plan,
    render_command,
    validate_stage_plan,
)


@dataclass(frozen=True)
class PipelineJob:
    id: str
    status: str
    lang: str | None
    stage: str | None
    dry_run: bool
    created_at: str
    updated_at: str
    run_dir: Path
    log: str
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["run_dir"] = str(self.run_dir)
        return data


class JobStore:
    def __init__(self, repo_root: Path, config_path: Path):
        self.repo_root = repo_root.resolve()
        self.config_path = config_path
        self.config = load_pipeline_config(config_path, repo_root=self.repo_root)
        self.root = self.config.run_root / "ui-jobs"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    def status(self, env: Mapping[str, str] | None = None) -> dict[str, Any]:
        env = os.environ if env is None else env
        config = self._load_config()
        return {
            "languages": sorted(config.languages),
            "stages": ["normalize", "separate", "clip", "clean", "diarize", "tokenize", "cot", "build-dataset", "infer"],
            "credentials": {
                "HF_ACCESS_TOKEN": bool(env.get("HF_ACCESS_TOKEN")),
                "DASHSCOPE_API_KEY": bool(env.get("DASHSCOPE_API_KEY")),
            },
            "paths": {
                "config": str(self.config_path),
                "upstream_root": str(config.upstream_root),
                "run_root": str(config.run_root),
            },
        }

    def create_job(self, request: Mapping[str, Any]) -> PipelineJob:
        config = self._load_config()
        job_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-" + uuid.uuid4().hex[:8]
        run_dir = self.root / job_id
        run_dir.mkdir(parents=True, exist_ok=True)

        job = PipelineJob(
            id=job_id,
            status="queued",
            lang=request.get("lang"),
            stage=request.get("stage"),
            dry_run=bool(request.get("dry_run", True)),
            created_at=_now(),
            updated_at=_now(),
            run_dir=run_dir,
            log="",
        )
        self._write_job(job)

        if job.dry_run:
            return self._run_dry_job(config, job, request)

        thread = threading.Thread(target=self._run_live_job, args=(config, job, dict(request)), daemon=True)
        thread.start()
        return self.get_job(job.id)

    def create_audio_upload(self, lang: str, filename: str, content: bytes) -> PipelineJob:
        config = self._load_config()
        if lang not in config.languages:
            supported = ", ".join(sorted(config.languages))
            raise PipelineError(f"Unsupported language '{lang}'. Configured languages: {supported}.")
        if not content:
            raise PipelineError("Uploaded audio file is empty.")

        clean_name = _safe_audio_filename(filename)
        upload_dir = config.languages[lang].clean_root / "uploads"
        upload_dir.mkdir(parents=True, exist_ok=True)
        output_path = _dedupe_path(upload_dir / clean_name)
        output_path.write_bytes(content)

        job_id = datetime.now().strftime("%Y%m%d-%H%M%S-%f") + "-" + uuid.uuid4().hex[:8]
        run_dir = self.root / job_id
        run_dir.mkdir(parents=True, exist_ok=True)
        metadata = _audio_metadata(output_path)
        log_lines = [
            "Audio upload saved.",
            f"language: {lang}",
            f"filename: {filename}",
            f"saved_path: {output_path}",
            f"size_bytes: {output_path.stat().st_size}",
            *[f"{key}: {value}" for key, value in metadata.items()],
            "",
            "Suggested next step:",
            f"python3 -m translation_pipeline run --config {self.config_path} --lang {lang} --stage separate --dry-run",
            f"python3 -m translation_pipeline run --config {self.config_path} --lang {lang} --stage tokenize --dry-run",
        ]
        job = PipelineJob(
            id=job_id,
            status="success",
            lang=lang,
            stage="audio-upload",
            dry_run=False,
            created_at=_now(),
            updated_at=_now(),
            run_dir=run_dir,
            log="\n".join(log_lines) + "\n",
        )
        self._write_job(job)
        return job

    def get_job(self, job_id: str) -> PipelineJob:
        path = self.root / job_id / "job.json"
        if not path.exists():
            raise KeyError(job_id)
        data = json.loads(path.read_text(encoding="utf-8"))
        data["run_dir"] = Path(data["run_dir"])
        return PipelineJob(**data)

    def list_jobs(self) -> list[PipelineJob]:
        jobs = []
        for path in sorted(self.root.glob("*/job.json"), reverse=True):
            try:
                jobs.append(self.get_job(path.parent.name))
            except (OSError, json.JSONDecodeError, TypeError):
                continue
        return jobs

    def _run_dry_job(self, config: PipelineConfig, job: PipelineJob, request: Mapping[str, Any]) -> PipelineJob:
        try:
            stages = _build_request_plan(config, request)
            validate_stage_plan(stages, os.environ, check_paths=False, check_credentials=False)
            lines = []
            for stage in stages:
                lines.append(f"[dry-run] ({stage.name}) cd {stage.cwd} && {render_command(stage.command)}")
                lines.extend(f"[warning] {warning}" for warning in stage.warnings)
            final = _replace(job, status="success", updated_at=_now(), log="\n".join(lines) + "\n")
        except Exception as exc:
            final = _replace(job, status="failed", updated_at=_now(), error=str(exc), log=f"error: {exc}\n")
        self._write_job(final)
        return final

    def _run_live_job(self, config: PipelineConfig, job: PipelineJob, request: Mapping[str, Any]) -> None:
        try:
            stages = _build_request_plan(config, request)
            validate_stage_plan(stages, os.environ, check_paths=True, check_credentials=True)
            current = _replace(job, status="running", updated_at=_now())
            self._write_job(current)
            log_path = current.run_dir / "combined.log"
            with log_path.open("a", encoding="utf-8") as log_file:
                for stage in stages:
                    command_line = f"$ cd {stage.cwd} && {render_command(stage.command)}\n"
                    log_file.write(command_line)
                    log_file.flush()
                    command = [os.environ.get(part[2:-1], "") if part.startswith("${") and part.endswith("}") else part for part in stage.command]
                    result = subprocess.run(command, cwd=stage.cwd, stdout=log_file, stderr=subprocess.STDOUT, text=True)
                    if result.returncode != 0:
                        raise PipelineError(f"Stage '{stage.name}' failed with exit code {result.returncode}.")
            final_log = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
            self._write_job(_replace(current, status="success", updated_at=_now(), log=final_log))
        except (PipelineError, CredentialError, OSError) as exc:
            existing_log = ""
            log_path = job.run_dir / "combined.log"
            if log_path.exists():
                existing_log = log_path.read_text(encoding="utf-8")
            self._write_job(_replace(job, status="failed", updated_at=_now(), error=str(exc), log=existing_log + f"\nerror: {exc}\n"))

    def _write_job(self, job: PipelineJob) -> None:
        with self._lock:
            (job.run_dir / "job.json").write_text(json.dumps(job.to_dict(), indent=2), encoding="utf-8")

    def _load_config(self) -> PipelineConfig:
        self.config = load_pipeline_config(self.config_path, repo_root=self.repo_root)
        return self.config


def _build_request_plan(config: PipelineConfig, request: Mapping[str, Any]):
    return build_stage_plan(
        config,
        lang=request.get("lang"),
        only_stage=request.get("stage") or None,
        from_stage=request.get("from_stage") or None,
        to_stage=request.get("to_stage") or None,
        execute_cleanup=bool(request.get("execute_cleanup", False)),
    )


def _replace(job: PipelineJob, **changes: Any) -> PipelineJob:
    data = job.to_dict()
    data.update(changes)
    data["run_dir"] = Path(data["run_dir"])
    return PipelineJob(**data)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_audio_filename(filename: str) -> str:
    source = Path(filename).name
    stem = Path(source).stem.lower()
    suffix = Path(source).suffix.lower()
    if suffix not in {".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg"}:
        raise PipelineError("Upload must be an audio file: wav, mp3, m4a, flac, aac, or ogg.")
    stem = re.sub(r"[^a-z0-9]+", "_", stem).strip("_")
    if not stem:
        stem = "audio"
    return f"{stem}{suffix}"


def _dedupe_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(1, 10_000):
        candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise PipelineError(f"Unable to choose unique path for {path.name}.")


def _audio_metadata(path: Path) -> dict[str, str]:
    if path.suffix.lower() != ".wav":
        return {"duration_seconds": "unknown", "format": path.suffix.lower().lstrip(".")}
    try:
        with wave.open(str(path), "rb") as wav:
            frames = wav.getnframes()
            rate = wav.getframerate()
            channels = wav.getnchannels()
            duration = frames / rate if rate else 0.0
            return {
                "duration_seconds": f"{duration:.2f}",
                "sample_rate_hz": str(rate),
                "channels": str(channels),
                "sample_width_bytes": str(wav.getsampwidth()),
            }
    except wave.Error:
        return {"duration_seconds": "unknown", "format": "wav"}
