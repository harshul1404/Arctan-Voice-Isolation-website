from __future__ import annotations

import argparse
import os
import shutil
import sys
from pathlib import Path

from .config import ConfigError, load_pipeline_config
from .runner import (
    GLOBAL_STAGES,
    LANGUAGE_STAGES,
    PipelineError,
    build_stage_plan,
    render_command,
    run_stages,
    selected_stage_names,
    validate_stage_plan,
)


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "doctor":
            return _doctor(args)
        if args.command == "init":
            return _init(args)
        if args.command == "run":
            return _run(args)
    except (ConfigError, PipelineError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    parser.print_help()
    return 1


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="translation_pipeline")
    parser.add_argument("--config", default=None, help="Path to pipeline YAML config.")
    subparsers = parser.add_subparsers(dest="command")

    init = subparsers.add_parser("init", help="Show or run upstream FunCineForge setup.")
    init.add_argument("--config", default=None, help="Path to pipeline YAML config.")
    init.add_argument("--dry-run", action="store_true", help="Print setup commands without running them.")

    run = subparsers.add_parser("run", help="Run one or more pipeline stages.")
    run.add_argument("--config", default=None, help="Path to pipeline YAML config.")
    run.add_argument("--lang", choices=["zh", "en"], help="Language to process for language-specific stages.")
    run.add_argument("--stage", choices=LANGUAGE_STAGES + GLOBAL_STAGES, help="Run only one stage.")
    run.add_argument("--from-stage", choices=LANGUAGE_STAGES + GLOBAL_STAGES, help="Start from this stage.")
    run.add_argument("--to-stage", choices=LANGUAGE_STAGES + GLOBAL_STAGES, help="Stop after this stage.")
    run.add_argument("--dry-run", action="store_true", help="Print exact commands without executing.")
    run.add_argument("--execute-cleanup", action="store_true", help="Allow clean_video.py and clean_srt.py to delete files.")

    doctor = subparsers.add_parser("doctor", help="Check local tools, upstream checkout, and configured paths.")
    doctor.add_argument("--config", default=None, help="Path to pipeline YAML config.")
    return parser


def _config(args: argparse.Namespace):
    return load_pipeline_config(Path(args.config or "configs/pipeline.yaml"))


def _init(args: argparse.Namespace) -> int:
    config = _config(args)
    commands = [
        ["git", "submodule", "update", "--init", "--recursive"],
        ["git", "-C", str(config.upstream_root), "checkout", "f24dd46266b65fd191c37d8ca10eefc82115bda0"],
        ["python", "setup.py"],
    ]
    for command in commands:
        print(render_command(command))
    if args.dry_run:
        return 0
    print("Run the printed commands manually after reviewing model download and dependency impact.", file=sys.stderr)
    return 1


def _run(args: argparse.Namespace) -> int:
    config = _config(args)
    stages = []
    if args.lang is None and _needs_all_languages(args.stage, args.from_stage, args.to_stage):
        selected = selected_stage_names(args.stage, args.from_stage, args.to_stage)
        language_selected = [stage for stage in selected if stage in LANGUAGE_STAGES]
        global_selected = [stage for stage in selected if stage in GLOBAL_STAGES]
        for lang in config.languages:
            for stage in language_selected:
                stages.extend(
                    build_stage_plan(
                        config,
                        lang=lang,
                        only_stage=stage,
                        execute_cleanup=args.execute_cleanup,
                    )
                )
        for stage in global_selected:
            stages.extend(build_stage_plan(config, lang=None, only_stage=stage))
    else:
        stages = build_stage_plan(
            config,
            lang=args.lang,
            only_stage=args.stage,
            from_stage=args.from_stage,
            to_stage=args.to_stage,
            execute_cleanup=args.execute_cleanup,
        )

    validate_stage_plan(
        stages,
        os.environ,
        check_paths=not args.dry_run,
        check_credentials=not args.dry_run,
    )
    run_dir = run_stages(stages, config.run_root, dry_run=args.dry_run)
    print(f"run log: {run_dir}")
    return 0


def _doctor(args: argparse.Namespace) -> int:
    config = _config(args)
    failures = 0
    checks = [
        ("ffmpeg", shutil.which("ffmpeg") is not None),
        ("ffprobe", shutil.which("ffprobe") is not None),
        ("git", shutil.which("git") is not None),
        ("upstream", config.upstream_root.exists()),
        ("HF_ACCESS_TOKEN", bool(os.environ.get("HF_ACCESS_TOKEN"))),
        ("DASHSCOPE_API_KEY", bool(os.environ.get("DASHSCOPE_API_KEY"))),
    ]
    for label, ok in checks:
        print(f"{label}: {'ok' if ok else 'missing'}")
        if not ok and label in {"ffmpeg", "ffprobe", "git", "upstream"}:
            failures += 1
    for code, language in config.languages.items():
        print(f"{code}.raw_root: {language.raw_root}")
        print(f"{code}.clean_root: {language.clean_root}")
    return 1 if failures else 0


def _needs_all_languages(stage: str | None, from_stage: str | None, to_stage: str | None) -> bool:
    if stage is None:
        return True
    if stage in LANGUAGE_STAGES:
        return True
    return from_stage in LANGUAGE_STAGES or to_stage in LANGUAGE_STAGES


if __name__ == "__main__":
    raise SystemExit(main())
