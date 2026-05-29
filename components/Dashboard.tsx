"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Languages, Pencil, Sparkles, Video } from "lucide-react";
import { FileUpload } from "@/components/FileUpload";
import { JobProgress } from "@/components/JobProgress";
import { LanguageSelector } from "@/components/LanguageSelector";
import { OutputModeSelector } from "@/components/OutputModeSelector";
import { ResultPreview } from "@/components/ResultPreview";
import { TranscriptEditor } from "@/components/TranscriptEditor";
import { VoiceSelector } from "@/components/VoiceSelector";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { compatibleVoices, supportsAudioTarget } from "@/lib/languages";
import type { TranscriptPhrase } from "@/lib/alignedDubbing";
import { OutputMode } from "@/lib/validation";

type UploadedFile = {
  fileId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  localPath: string;
  fileType: "audio" | "video";
  publicUrl?: string;
};

type Result = {
  jobId: string;
  transcript: string;
  audioUrl?: string;
  videoUrl?: string;
};

// The aligned dubbing path (video → dubbed video) uses a 2-step workflow.
const isAlignedPath = (outputMode: OutputMode, fileType?: "audio" | "video") =>
  outputMode === "text_audio_video" && fileType === "video";

export function Dashboard({ maxUploadMb }: { maxUploadMb: number }) {
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [sourceLang, setSourceLang] = useState("auto");
  const [targetLang, setTargetLang] = useState("en");
  const [outputMode, setOutputMode] = useState<OutputMode>("text_audio");
  const [voice, setVoice] = useState("Cherry");
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Two-step aligned-dubbing state
  const [step, setStep] = useState<"idle" | "transcript_ready" | "done">("idle");
  const [transcriptJobId, setTranscriptJobId] = useState<string | null>(null);
  const [phrases, setPhrases] = useState<TranscriptPhrase[]>([]);
  const [editedPhrases, setEditedPhrases] = useState<TranscriptPhrase[]>([]);

  const wantsAudio = outputMode !== "text";
  const wantsVideo = outputMode === "text_audio_video";
  const allowedVoices = useMemo(() => compatibleVoices(targetLang), [targetLang]);
  const aligned = isAlignedPath(outputMode, uploadedFile?.fileType);

  useEffect(() => {
    if (!supportsAudioTarget(targetLang) && outputMode !== "text") setOutputMode("text");
    if (outputMode === "text_audio_video" && uploadedFile?.fileType !== "video") setOutputMode("text_audio");
    if (allowedVoices.length > 0 && !allowedVoices.includes(voice as never)) setVoice(allowedVoices[0]);
  }, [allowedVoices, outputMode, targetLang, uploadedFile?.fileType, voice]);

  // Reset two-step state when the file or settings change.
  useEffect(() => {
    setStep("idle");
    setTranscriptJobId(null);
    setPhrases([]);
    setEditedPhrases([]);
    setResult(null);
  }, [uploadedFile?.fileId, sourceLang, targetLang, outputMode, voice]);

  // ── Step 1: generate translated transcript ──────────────────────────────
  async function generateTranscript() {
    if (!uploadedFile) { setError("Upload a video file first."); return; }
    setIsBusy(true);
    setError("");
    setResult(null);
    setStep("idle");
    setProgress("Running ASR and translating phrases…");
    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: uploadedFile.fileId,
          fileType: uploadedFile.fileType,
          sourceLang: sourceLang === "auto" ? undefined : sourceLang,
          targetLang,
          voice
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Transcription failed.");
      const p: TranscriptPhrase[] = payload.phrases ?? [];
      setPhrases(p);
      setEditedPhrases(p);
      setTranscriptJobId(payload.jobId);
      setStep("transcript_ready");
      setProgress("Transcript ready — review and edit, then create the dubbed video.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Transcription failed.");
      setProgress("");
    } finally {
      setIsBusy(false);
    }
  }

  // ── Step 2: create dubbed video from (edited) transcript ─────────────────
  async function createDubbedVideo() {
    if (!uploadedFile || !transcriptJobId) return;
    setIsBusy(true);
    setError("");
    setProgress("Synthesizing voices and mixing timeline…");
    try {
      const response = await fetch("/api/dub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: transcriptJobId,
          fileId: uploadedFile.fileId,
          phrases: editedPhrases
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Dubbing failed.");
      setResult({ jobId: transcriptJobId, transcript: payload.transcript, audioUrl: payload.audioUrl, videoUrl: payload.videoUrl });
      setStep("done");
      setProgress("Complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Dubbing failed.");
      setProgress("");
    } finally {
      setIsBusy(false);
    }
  }

  // ── Standard 1-step flow (audio / text output) ───────────────────────────
  async function generate() {
    if (!uploadedFile) { setError("Upload an audio or video file first."); return; }
    setIsBusy(true);
    setError("");
    setResult(null);
    setProgress("Translating");
    const timers = [
      window.setTimeout(() => setProgress("Receiving transcript"), 700),
      ...(wantsAudio ? [window.setTimeout(() => setProgress("Receiving audio"), 1400)] : [])
    ];
    try {
      const response = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileId: uploadedFile.fileId,
          fileType: uploadedFile.fileType,
          sourceLang: sourceLang === "auto" ? undefined : sourceLang,
          targetLang,
          outputMode,
          voice: wantsAudio ? voice : undefined
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Translation failed.");
      setResult(payload);
      setProgress("Complete");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Translation failed.");
      setProgress("");
    } finally {
      timers.forEach(clearTimeout);
      setIsBusy(false);
    }
  }

  return (
    <main className="min-h-screen">
      <section className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-secondary px-3 py-1 text-sm text-muted-foreground">
                <Languages className="h-4 w-4" />
                Qwen3-LiveTranslate-Flash
              </div>
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Audio and video translation studio</h1>
              <p className="mt-3 max-w-3xl text-muted-foreground">
                Upload media, review and edit the translated transcript, then synthesize dubbed audio and video.
              </p>
            </div>
            <div className="rounded-md border bg-background px-4 py-3 text-sm text-muted-foreground sm:max-w-sm">
              Video dubbing uses a two-step workflow: generate the transcript first, edit any phrases, then create the final dubbed video.
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:px-8">
        <div className="space-y-6">
          <FileUpload
            maxUploadMb={maxUploadMb}
            uploadedFile={uploadedFile}
            disabled={isBusy}
            onUploaded={(file) => { setUploadedFile(file); setResult(null); setProgress(""); }}
            onError={setError}
            onStatus={setProgress}
          />

          <Card>
            <CardHeader>
              <CardTitle>Translation settings</CardTitle>
              <CardDescription>Choose language, output assets, and a compatible voice.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <LanguageSelector
                sourceLang={sourceLang} targetLang={targetLang} disabled={isBusy}
                onSourceChange={setSourceLang} onTargetChange={setTargetLang}
              />
              <div className="space-y-2">
                <div className="text-sm font-medium">Output mode</div>
                <OutputModeSelector
                  value={outputMode} targetLang={targetLang} fileType={uploadedFile?.fileType}
                  disabled={isBusy} onChange={setOutputMode}
                />
                {!supportsAudioTarget(targetLang) && (
                  <p className="text-xs text-muted-foreground">This target language supports transcript output only.</p>
                )}
              </div>
              {wantsAudio && (
                <VoiceSelector targetLang={targetLang} value={voice} disabled={isBusy} onChange={setVoice} />
              )}

              {/* ── Aligned dubbing: 2-step buttons ── */}
              {aligned ? (
                <div className="space-y-3">
                  {/* Step indicator */}
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${step !== "idle" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {step !== "idle" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "1"}
                    </span>
                    <span className={step !== "idle" ? "font-medium text-foreground" : ""}>Generate Transcript</span>
                    <ChevronRight className="h-3 w-3" />
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${step === "done" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {step === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : "2"}
                    </span>
                    <span className={step === "done" ? "font-medium text-foreground" : ""}>Create Dubbed Video</span>
                  </div>

                  <Button
                    className="w-full" variant={step === "transcript_ready" || step === "done" ? "outline" : "default"}
                    onClick={generateTranscript}
                    disabled={!uploadedFile || isBusy}
                  >
                    <Pencil className="h-4 w-4" />
                    {isBusy && step === "idle" ? "Generating transcript…" : "Generate Translated Transcript"}
                  </Button>

                  <Button
                    className="w-full"
                    onClick={createDubbedVideo}
                    disabled={!transcriptJobId || isBusy || editedPhrases.length === 0}
                  >
                    <Video className="h-4 w-4" />
                    {isBusy && step === "transcript_ready" ? "Creating dubbed video…" : "Create Dubbed Video"}
                  </Button>
                </div>
              ) : (
                /* ── Standard 1-step button ── */
                <Button className="w-full" onClick={generate} disabled={!uploadedFile || isBusy}>
                  <Sparkles className="h-4 w-4" />
                  {isBusy ? "Generating..." : "Generate"}
                </Button>
              )}

              {error && (
                <div className="flex gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ── Editable transcript (shown between step 1 and step 2) ── */}
          {aligned && step === "transcript_ready" && editedPhrases.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Translated Transcript</CardTitle>
                <CardDescription>
                  {editedPhrases.length} phrase{editedPhrases.length !== 1 ? "s" : ""} detected.
                  Edit any translation before creating the dubbed video.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TranscriptEditor
                  phrases={editedPhrases}
                  disabled={isBusy}
                  onChange={setEditedPhrases}
                />
              </CardContent>
            </Card>
          )}

          {/* ── Result (video / audio / transcript download) ── */}
          {(result || (step === "done" && result)) && <ResultPreview result={result!} />}
          {!aligned && result && <ResultPreview result={result} />}
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Job progress</CardTitle>
              <CardDescription>{progress ? "Moving through these stages." : "Progress appears here after upload."}</CardDescription>
            </CardHeader>
            <CardContent>
              <JobProgress current={progress} wantsAudio={wantsAudio} wantsVideo={wantsVideo} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Output support</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Audio/video output is available for English, Chinese, Russian, French, German, Portuguese, Spanish, Italian, Korean, Japanese, and Cantonese.</p>
              <p>Hindi, Arabic, Turkish, Greek, Thai, Vietnamese, and Indonesian support transcript output only.</p>
              <p>Video dubbing uses speaker diarization and per-speaker voice cloning when QWEN_VOICE_CLONING is enabled.</p>
            </CardContent>
          </Card>
        </aside>
      </section>
    </main>
  );
}
