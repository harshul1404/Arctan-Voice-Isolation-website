from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


@dataclass(frozen=True)
class LanguageConfig:
    code: str
    raw_root: Path
    clean_root: Path
    clip_device: str


@dataclass(frozen=True)
class TrimConfig:
    intro: int
    outro: int
    workers: int | None = None


@dataclass(frozen=True)
class ExecutionConfig:
    device: str
    cleanup_execute: bool
    provider: str
    model: str
    dataset_out_dir: Path
    speech_gpus: list[int]
    diarization_gpus: str


@dataclass(frozen=True)
class PipelineConfig:
    repo_root: Path
    upstream_root: Path
    run_root: Path
    languages: dict[str, LanguageConfig]
    trim: TrimConfig
    execution: ExecutionConfig


class ConfigError(ValueError):
    pass


def load_pipeline_config(path: str | Path, repo_root: str | Path | None = None) -> PipelineConfig:
    config_path = Path(path).expanduser()
    if repo_root is None:
        repo_root_path = config_path.resolve().parent.parent
    else:
        repo_root_path = Path(repo_root).expanduser().resolve()

    with config_path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle) or {}

    project = _mapping(data.get("project"), "project")
    languages_data = _mapping(data.get("languages"), "languages")
    trim_data = _mapping(data.get("trim"), "trim")
    execution_data = _mapping(data.get("execution"), "execution")

    languages: dict[str, LanguageConfig] = {}
    for code, item in languages_data.items():
        item_map = _mapping(item, f"languages.{code}")
        languages[code] = LanguageConfig(
            code=code,
            raw_root=_resolve(repo_root_path, _required(item_map, "raw_root", f"languages.{code}")),
            clean_root=_resolve(repo_root_path, _required(item_map, "clean_root", f"languages.{code}")),
            clip_device=str(item_map.get("clip_device", execution_data.get("device", "cpu"))),
        )

    if not languages:
        raise ConfigError("At least one language must be configured.")

    execution = ExecutionConfig(
        device=str(execution_data.get("device", "cpu")),
        cleanup_execute=bool(execution_data.get("cleanup_execute", False)),
        provider=str(execution_data.get("provider", "google")),
        model=str(execution_data.get("model", "gemini-3-pro-preview")),
        dataset_out_dir=_resolve(repo_root_path, execution_data.get("dataset_out_dir", "datasets/clean")),
        speech_gpus=[int(gpu) for gpu in execution_data.get("speech_gpus", [])],
        diarization_gpus=str(execution_data.get("diarization_gpus", "-1")),
    )

    return PipelineConfig(
        repo_root=repo_root_path,
        upstream_root=_resolve(repo_root_path, project.get("upstream_root", "third_party/FunCineForge")),
        run_root=_resolve(repo_root_path, project.get("run_root", "runs")),
        languages=languages,
        trim=TrimConfig(
            intro=int(trim_data.get("intro", 10)),
            outro=int(trim_data.get("outro", 10)),
            workers=int(trim_data["workers"]) if trim_data.get("workers") is not None else None,
        ),
        execution=execution,
    )


def _resolve(repo_root: Path, value: Any) -> Path:
    path = Path(str(value)).expanduser()
    if path.is_absolute():
        return path
    return repo_root / path


def _mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{label} must be a mapping.")
    return value


def _required(mapping: dict[str, Any], key: str, label: str) -> Any:
    if key not in mapping:
        raise ConfigError(f"{label}.{key} is required.")
    return mapping[key]
