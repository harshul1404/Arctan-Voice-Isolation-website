import React from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  FolderOpen,
  Upload,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";
import "./styles.css";

type Status = {
  languages: string[];
  stages: string[];
  credentials: Record<string, boolean>;
  paths: Record<string, string>;
};

type Job = {
  id: string;
  status: "queued" | "running" | "success" | "failed";
  lang: string | null;
  stage: string | null;
  dry_run: boolean;
  created_at: string;
  updated_at: string;
  run_dir: string;
  log: string;
  error: string | null;
};

const stageOptions = [
  { value: "", label: "Full pipeline" },
  { value: "normalize", label: "Normalize" },
  { value: "separate", label: "Speech separation" },
  { value: "clip", label: "Clip + subtitles" },
  { value: "clean", label: "Cleanup check" },
  { value: "diarize", label: "Speaker diarization" },
  { value: "tokenize", label: "Speech tokens" },
  { value: "cot", label: "CoT correction" },
  { value: "build-dataset", label: "Build dataset" },
  { value: "infer", label: "Inference" },
];

function App() {
  const [status, setStatus] = React.useState<Status | null>(null);
  const [jobs, setJobs] = React.useState<Job[]>([]);
  const [selectedJobId, setSelectedJobId] = React.useState<string | null>(null);
  const [lang, setLang] = React.useState("zh");
  const [stage, setStage] = React.useState("");
  const [dryRun, setDryRun] = React.useState(true);
  const [executeCleanup, setExecuteCleanup] = React.useState(false);
  const [audioFile, setAudioFile] = React.useState<File | null>(null);
  const [isUploading, setIsUploading] = React.useState(false);
  const [isStarting, setIsStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;

  const refresh = React.useCallback(async () => {
    const [statusResponse, jobsResponse] = await Promise.all([fetch("/api/status"), fetch("/api/jobs")]);
    if (!statusResponse.ok || !jobsResponse.ok) {
      throw new Error("Unable to load pipeline status.");
    }
    setStatus(await statusResponse.json());
    const nextJobs = (await jobsResponse.json()) as Job[];
    setJobs(nextJobs);
    if (!selectedJobId && nextJobs.length > 0) {
      setSelectedJobId(nextJobs[0].id);
    }
  }, [selectedJobId]);

  React.useEffect(() => {
    refresh().catch((caught: Error) => setError(caught.message));
    const timer = window.setInterval(() => {
      refresh().catch(() => undefined);
    }, 2500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function startJob() {
    setIsStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang,
          stage: stage || null,
          dry_run: dryRun,
          execute_cleanup: executeCleanup,
        }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const job = (await response.json()) as Job;
      setSelectedJobId(job.id);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start pipeline job.");
    } finally {
      setIsStarting(false);
    }
  }

  async function uploadAudio() {
    if (!audioFile) {
      setError("Choose an audio file first.");
      return;
    }
    setIsUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("lang", lang);
      body.append("file", audioFile);
      const response = await fetch("/api/uploads/audio", {
        method: "POST",
        body,
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const job = (await response.json()) as Job;
      setSelectedJobId(job.id);
      setAudioFile(null);
      const input = document.getElementById("audio-upload") as HTMLInputElement | null;
      if (input) input.value = "";
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to upload audio.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">FunCineForge</p>
          <h1>Translation Pipeline</h1>
        </div>
        <button className="icon-button" onClick={() => refresh()} aria-label="Refresh status">
          <RefreshCw size={18} />
        </button>
      </section>

      {error ? (
        <div className="alert" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="status-grid">
        <StatusTile icon={<ShieldCheck size={18} />} label="Hugging Face" ok={Boolean(status?.credentials.HF_ACCESS_TOKEN)} />
        <StatusTile icon={<ShieldCheck size={18} />} label="DashScope" ok={Boolean(status?.credentials.DASHSCOPE_API_KEY)} />
        <InfoTile icon={<FolderOpen size={18} />} label="Runs" value={status?.paths.run_root ?? "Loading"} />
        <InfoTile icon={<Settings2 size={18} />} label="Config" value={status?.paths.config ?? "Loading"} />
      </section>

      <section className="workspace">
        <form className="panel controls" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Control</p>
              <h2>Start a Job</h2>
            </div>
            <button className="primary-button" type="button" onClick={startJob} disabled={isStarting}>
              {isStarting ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
              Start
            </button>
          </div>

          <label>
            Language
            <select value={lang} onChange={(event) => setLang(event.target.value)}>
              {(status?.languages ?? ["zh", "en"]).map((code) => (
                <option value={code} key={code}>
                  {code === "zh" ? "Chinese" : "English"} ({code})
                </option>
              ))}
            </select>
          </label>

          <label>
            Stage
            <select value={stage} onChange={(event) => setStage(event.target.value)}>
              {stageOptions.map((option) => (
                <option value={option.value} key={option.label}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="switch-row">
            <label className="switch">
              <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
              <span>Dry run</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={executeCleanup}
                onChange={(event) => setExecuteCleanup(event.target.checked)}
              />
              <span>Allow cleanup deletes</span>
            </label>
          </div>

          {lang === "en" ? (
            <div className="note">
              <AlertTriangle size={16} />
              English clipping is supported on CPU, but upstream recommends GPU acceleration.
            </div>
          ) : null}

          <div className="upload-box">
            <div>
              <p className="eyebrow">Audio</p>
              <h3>Upload Audio</h3>
              <p>Stores WAV/MP3/M4A/FLAC files in the selected language dataset.</p>
            </div>
            <label className="file-picker" htmlFor="audio-upload">
              <Upload size={17} />
              <span>{audioFile ? audioFile.name : "Choose audio"}</span>
              <input
                id="audio-upload"
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.flac,.aac,.ogg"
                onChange={(event) => setAudioFile(event.target.files?.[0] ?? null)}
              />
            </label>
            <button className="secondary-button" type="button" onClick={uploadAudio} disabled={isUploading || !audioFile}>
              {isUploading ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
              Upload
            </button>
          </div>
        </form>

        <section className="panel jobs-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Runs</p>
              <h2>Job History</h2>
            </div>
            <span className="count">{jobs.length}</span>
          </div>
          <div className="job-list">
            {jobs.length === 0 ? <p className="empty">No jobs yet. Start with a dry run.</p> : null}
            {jobs.map((job) => (
              <button
                type="button"
                className={`job-row ${selectedJob?.id === job.id ? "active" : ""}`}
                onClick={() => setSelectedJobId(job.id)}
                key={job.id}
              >
                <StatusIcon status={job.status} />
                <span>
                  <strong>{job.stage || "full pipeline"}</strong>
                  <small>
                    {job.lang || "global"} · {job.dry_run ? "dry-run" : "live"}
                  </small>
                </span>
              </button>
            ))}
          </div>
        </section>
      </section>

      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Details</p>
            <h2>{selectedJob ? selectedJob.id : "No job selected"}</h2>
          </div>
          {selectedJob ? <span className={`badge ${selectedJob.status}`}>{selectedJob.status}</span> : null}
        </div>

        {selectedJob ? (
          <div className="detail-grid">
            <div className="meta-list">
              <Meta icon={<Clock3 size={16} />} label="Updated" value={new Date(selectedJob.updated_at).toLocaleString()} />
              <Meta icon={<FolderOpen size={16} />} label="Run directory" value={selectedJob.run_dir} />
              <Meta icon={<FileText size={16} />} label="Mode" value={selectedJob.dry_run ? "Dry run" : "Live execution"} />
            </div>
            <pre className="log-view">
              {selectedJob.log || selectedJob.error || "Waiting for logs..."}
            </pre>
          </div>
        ) : (
          <p className="empty">Select a job to inspect commands and logs.</p>
        )}
      </section>
    </main>
  );
}

function StatusTile({ icon, label, ok }: { icon: React.ReactNode; label: string; ok: boolean }) {
  return (
    <div className="tile">
      {icon}
      <span>
        <small>{label}</small>
        <strong>{ok ? "Ready" : "Missing"}</strong>
      </span>
    </div>
  );
}

function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="tile wide">
      {icon}
      <span>
        <small>{label}</small>
        <strong title={value}>{value}</strong>
      </span>
    </div>
  );
}

function StatusIcon({ status }: { status: Job["status"] }) {
  if (status === "success") return <CheckCircle2 className="ok" size={18} />;
  if (status === "failed") return <AlertTriangle className="bad" size={18} />;
  if (status === "running") return <Loader2 className="spin" size={18} />;
  return <TerminalSquare size={18} />;
}

function Meta({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="meta">
      {icon}
      <span>
        <small>{label}</small>
        <strong>{value}</strong>
      </span>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
