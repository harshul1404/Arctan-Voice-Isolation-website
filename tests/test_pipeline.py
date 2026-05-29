import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from translation_pipeline.config import load_pipeline_config
from translation_pipeline.runner import (
    CredentialError,
    build_stage_plan,
    validate_stage_plan,
)


def write_config(root: Path) -> Path:
    config_path = root / "pipeline.yaml"
    config_path.write_text(
        """
project:
  upstream_root: third_party/FunCineForge
  run_root: runs
languages:
  zh:
    raw_root: datasets/raw_zh
    clean_root: datasets/clean/zh
    clip_device: cpu
  en:
    raw_root: datasets/raw_en
    clean_root: datasets/clean/en
    clip_device: cpu
trim:
  intro: 10
  outro: 10
execution:
  device: cpu
  cleanup_execute: false
  provider: google
  model: gemini-3-pro-preview
  dataset_out_dir: datasets/clean
""".strip(),
        encoding="utf-8",
    )
    return config_path


class PipelineTests(unittest.TestCase):
    def test_config_parsing_expands_language_paths(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = load_pipeline_config(write_config(root), repo_root=root)

            self.assertEqual(config.languages["zh"].raw_root, root / "datasets/raw_zh")
            self.assertEqual(config.languages["zh"].clean_root, root / "datasets/clean/zh")
            self.assertEqual(config.languages["en"].raw_root, root / "datasets/raw_en")
            self.assertEqual(config.trim.intro, 10)
            self.assertEqual(config.execution.device, "cpu")

    def test_cpu_commands_omit_speech_separation_gpus_and_pass_diarization_minus_one(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = load_pipeline_config(write_config(root), repo_root=root)

            separate = build_stage_plan(config, lang="zh", only_stage="separate")[0]
            diarize = build_stage_plan(config, lang="zh", only_stage="diarize")[0]

            self.assertEqual(separate.command[:2], ["python", "run.py"])
            self.assertNotIn("--gpus", separate.command)
            self.assertEqual(separate.cwd, root / "third_party/FunCineForge/speech_separation")
            self.assertEqual(
                diarize.command,
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
                    str(root / "datasets/clean/zh"),
                    "--gpus",
                    "-1",
                ],
            )

    def test_english_clip_warns_but_uses_cpu_when_configured(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = load_pipeline_config(write_config(root), repo_root=root)

            clip = build_stage_plan(config, lang="en", only_stage="clip")[0]

            self.assertEqual(clip.command[-2:], ["--device", "cpu"])
            self.assertTrue(
                any("English clipping is GPU-recommended" in warning for warning in clip.warnings)
            )

    def test_gated_stages_require_credentials(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = load_pipeline_config(write_config(root), repo_root=root)
            clean_env = {k: v for k, v in os.environ.items() if k not in {"HF_ACCESS_TOKEN", "DASHSCOPE_API_KEY"}}

            with patch.dict(os.environ, clean_env, clear=True):
                with self.assertRaisesRegex(CredentialError, "HF_ACCESS_TOKEN"):
                    validate_stage_plan(build_stage_plan(config, lang="zh", only_stage="diarize"), os.environ)

                with self.assertRaisesRegex(CredentialError, "DASHSCOPE_API_KEY"):
                    validate_stage_plan(build_stage_plan(config, lang="zh", only_stage="cot"), os.environ)

    def test_stage_ranges_and_dataset_build_are_language_aware(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            config = load_pipeline_config(write_config(root), repo_root=root)

            ranged = build_stage_plan(config, lang="zh", from_stage="clip", to_stage="tokenize")
            dataset = build_stage_plan(config, lang=None, only_stage="build-dataset")[0]

            self.assertEqual([stage.name for stage in ranged], ["clip", "clean-video", "clean-srt", "diarize", "tokenize"])
            self.assertEqual(
                dataset.command,
                [
                    "python",
                    "build_datasets.py",
                    "--root_zh",
                    str(root / "datasets/clean/zh"),
                    "--root_en",
                    str(root / "datasets/clean/en"),
                    "--out_dir",
                    str(root / "datasets/clean"),
                    "--save",
                ],
            )


if __name__ == "__main__":
    unittest.main()
