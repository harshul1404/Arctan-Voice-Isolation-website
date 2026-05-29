import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from translation_pipeline.web.jobs import JobStore


class WebJobTests(unittest.TestCase):
    def test_dry_run_job_writes_status_and_log(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = _write_config(root)
            store = JobStore(repo_root=root, config_path=config_path)

            job = store.create_job({"lang": "zh", "stage": "normalize", "dry_run": True})
            completed = store.get_job(job.id)

            self.assertEqual(completed.status, "success")
            self.assertEqual(completed.lang, "zh")
            self.assertEqual(completed.stage, "normalize")
            self.assertIn("normalize_trim.py", completed.log)
            self.assertTrue((completed.run_dir / "job.json").exists())

    def test_status_reports_credentials_without_revealing_values(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = _write_config(root)
            store = JobStore(repo_root=root, config_path=config_path)

            status = store.status(env={"HF_ACCESS_TOKEN": "secret", "DASHSCOPE_API_KEY": ""})

            self.assertTrue(status["credentials"]["HF_ACCESS_TOKEN"])
            self.assertFalse(status["credentials"]["DASHSCOPE_API_KEY"])
            self.assertNotIn("secret", json.dumps(status))
            self.assertEqual(status["languages"], ["en", "zh"])

    def test_audio_upload_writes_file_and_metadata_job(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = _write_config(root)
            store = JobStore(repo_root=root, config_path=config_path)

            job = store.create_audio_upload(
                lang="en",
                filename="American Accent!.wav",
                content=_tiny_wav_bytes(),
            )

            output_path = root / "datasets/clean/en/uploads/american_accent.wav"
            self.assertEqual(job.status, "success")
            self.assertEqual(job.stage, "audio-upload")
            self.assertTrue(output_path.exists())
            self.assertIn("Audio upload saved", job.log)
            self.assertIn("duration_seconds: 0.01", job.log)
            self.assertIn(str(output_path), job.log)


def _write_config(root: Path) -> Path:
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
  speech_gpus: []
  diarization_gpus: "-1"
""".strip(),
        encoding="utf-8",
    )
    return config_path


def _tiny_wav_bytes() -> bytes:
    import io
    import wave

    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(8000)
        wav.writeframes(b"\x00\x00" * 80)
    return buffer.getvalue()


if __name__ == "__main__":
    unittest.main()
