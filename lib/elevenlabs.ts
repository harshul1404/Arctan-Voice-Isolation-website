import { promises as fs } from "fs";
import { nanoid } from "nanoid";
import { outputPath, publicOutputUrl, UploadMetadata } from "@/lib/storage";

type ElevenLabsDubInput = {
  upload: UploadMetadata;
  sourceLang?: string;
  targetLang: string;
};

type DubStatus = {
  status?: string;
  error?: string;
  target_languages?: string[];
};

const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io/v1";

function getApiKey() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Missing ELEVENLABS_API_KEY.");
  return key;
}

async function elevenLabsFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${ELEVENLABS_BASE_URL}${path}`, {
    ...init,
    headers: {
      "xi-api-key": getApiKey(),
      ...(init.headers ?? {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${detail}`);
  }
  return response;
}

export async function createElevenLabsDub(input: ElevenLabsDubInput) {
  const form = new FormData();
  const fileBuffer = await fs.readFile(input.upload.localPath);
  form.append("file", new Blob([fileBuffer], { type: input.upload.mimeType }), input.upload.originalName);
  form.append("target_lang", input.targetLang);
  if (input.sourceLang && input.sourceLang !== "auto") form.append("source_lang", input.sourceLang);
  form.append("num_speakers", "0");
  form.append("watermark", "false");
  form.append("highest_resolution", "true");
  form.append("drop_background_audio", "false");
  form.append("disable_voice_cloning", "false");

  const createResponse = await elevenLabsFetch("/dubbing", {
    method: "POST",
    body: form
  });
  const created = (await createResponse.json()) as { dubbing_id?: string; expected_duration_sec?: number };
  if (!created.dubbing_id) throw new Error("ElevenLabs did not return a dubbing ID.");

  const status = await waitForDub(created.dubbing_id, created.expected_duration_sec);
  if (status.status !== "dubbed") {
    throw new Error(status.error || `ElevenLabs dubbing ended with status: ${status.status ?? "unknown"}`);
  }

  const audioResponse = await elevenLabsFetch(`/dubbing/${created.dubbing_id}/audio/${input.targetLang}`);
  const contentType = audioResponse.headers.get("content-type") ?? "";
  const extension = contentType.includes("video") || input.upload.fileType === "video" ? "mp4" : "mp3";
  const jobId = nanoid(16);
  const filename = `${jobId}.${extension}`;
  await fs.writeFile(outputPath(filename), Buffer.from(await audioResponse.arrayBuffer()));

  return {
    jobId,
    transcript:
      "Dubbed with ElevenLabs production dubbing. Speaker detection, voice cloning, timing alignment, and background audio handling are managed by ElevenLabs.",
    videoUrl: extension === "mp4" ? publicOutputUrl(filename) : undefined,
    audioUrl: extension !== "mp4" ? publicOutputUrl(filename) : undefined,
    usage: {
      provider: "elevenlabs",
      dubbingId: created.dubbing_id,
      status
    }
  };
}

async function waitForDub(dubbingId: string, expectedDurationSec?: number) {
  const deadlineMs = Date.now() + Math.max(15 * 60_000, (expectedDurationSec ?? 60) * 20_000);

  while (Date.now() < deadlineMs) {
    const response = await elevenLabsFetch(`/dubbing/${dubbingId}`);
    const status = (await response.json()) as DubStatus;
    if (status.status === "dubbed" || status.status === "failed") return status;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error("ElevenLabs dubbing timed out before the job completed.");
}
