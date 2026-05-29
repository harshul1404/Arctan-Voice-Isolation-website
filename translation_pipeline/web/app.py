from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from translation_pipeline.web.jobs import JobStore


class JobRequest(BaseModel):
    lang: str | None = "zh"
    stage: str | None = None
    from_stage: str | None = None
    to_stage: str | None = None
    dry_run: bool = True
    execute_cleanup: bool = False


def create_app(repo_root: Path | None = None, config_path: Path | None = None) -> FastAPI:
    root = (repo_root or Path.cwd()).resolve()
    store = JobStore(root, config_path or root / "configs/pipeline.yaml")
    app = FastAPI(title="FunCineForge Pipeline UI")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/status")
    def status() -> dict[str, Any]:
        return store.status()

    @app.get("/api/jobs")
    def jobs() -> list[dict[str, Any]]:
        return [job.to_dict() for job in store.list_jobs()]

    @app.post("/api/jobs")
    def create_job(request: JobRequest) -> dict[str, Any]:
        return store.create_job(request.model_dump()).to_dict()

    @app.post("/api/uploads/audio")
    async def upload_audio(lang: str = Form("en"), file: UploadFile = File(...)) -> dict[str, Any]:
        content = await file.read()
        return store.create_audio_upload(lang=lang, filename=file.filename or "audio.wav", content=content).to_dict()

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        try:
            return store.get_job(job_id).to_dict()
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Job not found") from exc

    static_dir = root / "ui" / "dist"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    return app


app = create_app()
