from __future__ import annotations

import os
import shlex
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Mapping, Sequence

from .config import LanguageConfig, PipelineConfig


LANGUAGE_STAGES = ["normalize", "separate", "clip", "clean", "diarize", "tokenize", "cot"]
GLOBAL_STAGES = ["build-dataset", "infer"]
STAGE_ORDER = LANGUAGE_STAGES + GLOBAL_STAGES


@dataclass(frozen=True)
class StageCommand:
    name: str
    command: list[str]
    cwd: Path
    warnings: list[str] = field(default_factory=list)
    requires_env: list[str] = field(default_factory=list)
    check_paths: list[Path] = field(default_factory=list)


class PipelineError(RuntimeError):
    pass


class CredentialError(PipelineError):
    pass


class MissingPathError(PipelineError):
    pass


def build_stage_plan(
    config: PipelineConfig,
    lang: str | None,
    only_stage: str | None = None,
    from_stage: str | None = None,
    to_stage: str | None = None,
    execute_cleanup: bool | None = None,
) -> list[StageCommand]:
    selected_names = selected_stage_names(only_stage, from_stage, to_stage)
    stages: list[StageCommand] = []
    for name in selected_names:
        if name in LANGUAGE_STAGES:
            if lang is None:
                raise PipelineError(f"Stage '{name}' requires --lang.")
            if lang not in config.languages:
                supported = ", ".join(sorted(config.languages))
                raise PipelineError(f"Unsupported language '{lang}'. Configured languages: {supported}.")
            stages.extend(_language_stage(config, config.languages[lang], name, execute_cleanup))
        else:
            stages.append(_global_stage(config, name))
    return stages


def validate_stage_plan(
    stages: Sequence[StageCommand],
    env: Mapping[str, str],
    *,
    check_paths: bool = False,
    check_credentials: bool = True,
) -> None:
    if check_credentials:
        for stage in stages:
            for name in stage.requires_env:
                if not env.get(name):
                    raise CredentialError(f"Stage '{stage.name}' requires environment variable {name}.")
    if check_paths:
        for stage in stages:
            if not stage.cwd.exists():
                raise MissingPathError(f"Stage '{stage.name}' working directory does not exist: {stage.cwd}")
            for path in stage.check_paths:
                if not path.exists():
                    raise MissingPathError(f"Stage '{stage.name}' requires missing path: {path}")


def run_stages(stages: Sequence[StageCommand], run_root: Path, *, dry_run: bool) -> Path:
    run_dir = run_root / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    run_dir.mkdir(parents=True, exist_ok=True)
    summary_path = run_dir / "summary.txt"
    lines: list[str] = []

    for index, stage in enumerate(stages, start=1):
        rendered = render_command(stage.command)
        lines.append(f"[{index}] {stage.name}")
        lines.append(f"cwd: {stage.cwd}")
        lines.append(f"command: {rendered}")
        for warning in stage.warnings:
            lines.append(f"warning: {warning}")
        lines.append("")

        if dry_run:
            print(f"[dry-run] ({stage.name}) cd {stage.cwd} && {rendered}")
            for warning in stage.warnings:
                print(f"[warning] {warning}")
            continue

        stdout_path = run_dir / f"{index:02d}-{stage.name}.stdout.log"
        stderr_path = run_dir / f"{index:02d}-{stage.name}.stderr.log"
        command = _resolve_env_tokens(stage.command, os.environ)
        with stdout_path.open("w", encoding="utf-8") as stdout, stderr_path.open("w", encoding="utf-8") as stderr:
            result = subprocess.run(command, cwd=stage.cwd, stdout=stdout, stderr=stderr, text=True)
        lines.append(f"exit_code: {result.returncode}")
        lines.append(f"stdout: {stdout_path}")
        lines.append(f"stderr: {stderr_path}")
        lines.append("")
        if result.returncode != 0:
            summary_path.write_text("\n".join(lines), encoding="utf-8")
            raise PipelineError(f"Stage '{stage.name}' failed with exit code {result.returncode}. See {run_dir}.")

    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return run_dir


def render_command(command: Sequence[str]) -> str:
    return " ".join(shlex.quote(part) for part in command)


def selected_stage_names(
    only_stage: str | None,
    from_stage: str | None,
    to_stage: str | None,
) -> list[str]:
    for label, value in {"stage": only_stage, "from-stage": from_stage, "to-stage": to_stage}.items():
        if value is not None and value not in STAGE_ORDER:
            raise PipelineError(f"Unknown {label} '{value}'. Valid stages: {', '.join(STAGE_ORDER)}.")

    if only_stage:
        return [only_stage]

    start = STAGE_ORDER.index(from_stage) if from_stage else 0
    end = STAGE_ORDER.index(to_stage) if to_stage else len(STAGE_ORDER) - 1
    if start > end:
        raise PipelineError("--from-stage must come before --to-stage.")
    return STAGE_ORDER[start : end + 1]


def _language_stage(
    config: PipelineConfig,
    language: LanguageConfig,
    stage: str,
    execute_cleanup: bool | None,
) -> list[StageCommand]:
    upstream = config.upstream_root
    cleanup_execute = config.execution.cleanup_execute if execute_cleanup is None else execute_cleanup

    if stage == "normalize":
        command = [
            "python",
            "normalize_trim.py",
            "--root",
            str(language.raw_root),
            "--intro",
            str(config.trim.intro),
            "--outro",
            str(config.trim.outro),
        ]
        if config.trim.workers is not None:
            command.extend(["--workers", str(config.trim.workers)])
        return [StageCommand(stage, command, upstream, check_paths=[upstream / "normalize_trim.py"])]

    if stage == "separate":
        command = ["python", "run.py", "--root", str(language.clean_root)]
        if config.execution.device != "cpu" and config.execution.speech_gpus:
            command.extend(["--gpus", *[str(gpu) for gpu in config.execution.speech_gpus]])
        return [StageCommand(stage, command, upstream / "speech_separation", check_paths=[upstream / "speech_separation/run.py"])]

    if stage == "clip":
        warnings = []
        if language.code == "en" and language.clip_device == "cpu":
            warnings.append("English clipping is GPU-recommended upstream because it uses Qwen3-ASR/forced alignment.")
        return [
            StageCommand(
                stage,
                [
                    "bash",
                    "run.sh",
                    "--stage",
                    "1",
                    "--stop_stage",
                    "2",
                    "--input",
                    str(language.raw_root),
                    "--output",
                    str(language.clean_root),
                    "--lang",
                    language.code,
                    "--device",
                    language.clip_device,
                ],
                upstream / "video_clip",
                warnings=warnings,
                check_paths=[upstream / "video_clip/run.sh"],
            )
        ]

    if stage == "clean":
        commands = [
            StageCommand(
                "clean-video",
                ["python", "clean_video.py", "--root", str(language.clean_root)] + (["--execute"] if cleanup_execute else []),
                upstream,
                check_paths=[upstream / "clean_video.py"],
            ),
            StageCommand(
                "clean-srt",
                ["python", "clean_srt.py", "--root", str(language.clean_root), "--lang", language.code]
                + (["--execute"] if cleanup_execute else []),
                upstream,
                check_paths=[upstream / "clean_srt.py"],
            ),
        ]
        return commands

    if stage == "diarize":
        return [
            StageCommand(
                stage,
                [
                    "bash",
                    "run.sh",
                    "--stage",
                    "1",
                    "--stop_stage",
                    "4",
                    "--hf_access_token",
                    "${HF_ACCESS_TOKEN}",
                    "--root",
                    str(language.clean_root),
                    "--gpus",
                    config.execution.diarization_gpus,
                ],
                upstream / "speaker_diarization",
                requires_env=["HF_ACCESS_TOKEN"],
                check_paths=[upstream / "speaker_diarization/run.sh"],
            )
        ]

    if stage == "tokenize":
        return [
            StageCommand(
                stage,
                ["python", "speech_tokenizer.py", "--root", str(language.clean_root)],
                upstream,
                check_paths=[upstream / "speech_tokenizer.py"],
            )
        ]

    if stage == "cot":
        return [
            StageCommand(
                stage,
                [
                    "python",
                    "cot.py",
                    "--root_dir",
                    str(language.clean_root),
                    "--lang",
                    language.code,
                    "--provider",
                    config.execution.provider,
                    "--model",
                    config.execution.model,
                    "--api_key",
                    "${DASHSCOPE_API_KEY}",
                    "--resume",
                ],
                upstream,
                requires_env=["DASHSCOPE_API_KEY"],
                check_paths=[upstream / "cot.py"],
            )
        ]

    raise PipelineError(f"Unhandled language stage: {stage}")


def _global_stage(config: PipelineConfig, stage: str) -> StageCommand:
    upstream = config.upstream_root
    if stage == "build-dataset":
        return StageCommand(
            stage,
            [
                "python",
                "build_datasets.py",
                "--root_zh",
                str(config.languages["zh"].clean_root),
                "--root_en",
                str(config.languages["en"].clean_root),
                "--out_dir",
                str(config.execution.dataset_out_dir),
                "--save",
            ],
            upstream,
            check_paths=[upstream / "build_datasets.py"],
        )

    if stage == "infer":
        return StageCommand(
            stage,
            ["bash", "infer.sh"],
            upstream / "exps",
            check_paths=[upstream / "exps/infer.sh", upstream / "exps/funcineforge_zh_en"],
        )

    raise PipelineError(f"Unhandled global stage: {stage}")


def _resolve_env_tokens(command: Sequence[str], env: Mapping[str, str]) -> list[str]:
    resolved = []
    for part in command:
        if part.startswith("${") and part.endswith("}"):
            resolved.append(env[part[2:-1]])
        else:
            resolved.append(part)
    return resolved
