import { promises as fs } from "fs";
import WebSocket from "ws";

const DEFAULT_QWEN_VC_MODEL = "qwen3-tts-vc-2026-01-22";
const DEFAULT_QWEN_REALTIME_VC_MODEL = "qwen3-tts-vc-realtime-2026-01-15";

/** Map ISO-639-1 language codes to the language_type strings the TTS VC API expects. */
const LANG_TYPE_MAP: Record<string, string> = {
  zh: "Chinese",
  yue: "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  ru: "Russian"
};

export function langTypeForCode(code: string | undefined): string {
  return (code && LANG_TYPE_MAP[code]) || "English";
}

function dashScopeApiBase() {
  const base = process.env.DASHSCOPE_BASE_URL?.includes("dashscope-intl")
    ? "https://dashscope-intl.aliyuncs.com/api/v1"
    : "https://dashscope.aliyuncs.com/api/v1";
  return process.env.DASHSCOPE_API_BASE_URL || base;
}

function apiKey() {
  if (!process.env.DASHSCOPE_API_KEY) throw new Error("Missing DASHSCOPE_API_KEY.");
  return process.env.DASHSCOPE_API_KEY;
}

async function dashScopeFetch(path: string, body: unknown) {
  const response = await fetch(`${dashScopeApiBase()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text };
  }
  if (!response.ok || payload.code) {
    throw new Error(
      `DashScope Qwen voice API error ${response.status}: ${payload.message || payload.code || text}`
    );
  }
  return payload;
}

/**
 * Enroll a voice clone from a reference WAV.
 *
 * Returns the voice ID to pass to `synthesizeWithQwenClonedVoice`.
 * If the API enters fallback mode (reference audio too short/noisy, or the
 * feature is not available on the endpoint), the fallback voice is returned
 * and a warning is logged — the job is NOT failed so the user still gets output.
 */
export async function createQwenClonedVoice(input: {
  referenceAudioPath: string;
  preferredName: string;
  language?: string;
  transcript?: string;
  /** Override the target TTS model for this enrollment (defaults to QWEN_TTS_VC_MODEL env var). */
  model?: string;
}): Promise<string> {
  const audio = await fs.readFile(input.referenceAudioPath);
  const payload = await dashScopeFetch("/services/audio/tts/customization", {
    model: "qwen-voice-enrollment",
    input: {
      action: "create",
      target_model: input.model || process.env.QWEN_TTS_VC_MODEL || DEFAULT_QWEN_VC_MODEL,
      preferred_name: input.preferredName.replace(/[^\w]/g, "").slice(0, 16) || "speaker",
      language: input.language || "en",
      text: input.transcript,
      audio: { data: `data:audio/wav;base64,${audio.toString("base64")}` }
    }
  });

  const voice = payload.output?.voice;
  if (!voice) throw new Error("Qwen voice cloning did not return a voice ID.");

  if (payload.output?.fallback_mode) {
    // The API enrolled a fallback/generic voice rather than a true clone.
    // Log a warning but return it — synthesis can still proceed.
    console.warn(
      `[voice-clone] Speaker "${input.preferredName}": API returned fallback voice ` +
        `(${payload.output?.fallback_reason || "no reason given"}). ` +
        `Voice ID ${voice} will be used for synthesis but may not match the original speaker.`
    );
  } else {
    console.log(`[voice-clone] Speaker "${input.preferredName}": cloned voice ID = ${voice}`);
  }

  return voice as string;
}

export async function synthesizeWithQwenClonedVoice(input: {
  text: string;
  voice: string;
  languageType?: string;
  /** Override the TTS model for this synthesis call (defaults to QWEN_TTS_VC_MODEL env var). */
  model?: string;
}) {
  const model = input.model || process.env.QWEN_TTS_VC_MODEL || DEFAULT_QWEN_VC_MODEL;
  if (model.includes("-realtime")) {
    return synthesizeWithQwenRealtimeClonedVoice({
      ...input,
      model
    });
  }
  const payload = await dashScopeFetch("/services/aigc/multimodal-generation/generation", {
    model,
    input: {
      text: input.text,
      voice: input.voice,
      language_type: input.languageType || "English"
    }
  });
  const url = payload.output?.audio?.url;
  const data = payload.output?.audio?.data;
  if (data) return Buffer.from(data, "base64");
  if (!url) throw new Error("Qwen cloned voice synthesis did not return audio.");
  const audioResponse = await fetch(url);
  if (!audioResponse.ok) throw new Error(`Failed to download Qwen cloned TTS audio: ${audioResponse.status}`);
  return Buffer.from(await audioResponse.arrayBuffer());
}

async function synthesizeWithQwenRealtimeClonedVoice(input: {
  text: string;
  voice: string;
  languageType?: string;
  model?: string;
}) {
  const model = input.model || process.env.QWEN_TTS_VC_FALLBACK_MODEL || DEFAULT_QWEN_REALTIME_VC_MODEL;
  const urlBase = process.env.DASHSCOPE_WEBSOCKET_BASE_URL || "wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime";
  const url = `${urlBase}?model=${encodeURIComponent(model)}`;
  const audioChunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey()}`
      }
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error("Qwen realtime cloned TTS timed out."));
      }
    }, 120_000);

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // ignore close errors
      }
      reject(error);
    }

    function send(payload: unknown) {
      ws.send(JSON.stringify(payload));
    }

    ws.on("open", () => {
      send({
        event_id: eventId("session"),
        type: "session.update",
        session: {
          voice: input.voice,
          mode: "commit",
          language_type: input.languageType || "English",
          response_format: "pcm",
          sample_rate: 24000
        }
      });
    });

    ws.on("message", (data) => {
      let event: any;
      try {
        event = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (event.type === "error") {
        fail(new Error(`Qwen realtime cloned TTS error: ${event.error?.message || event.error?.code || "unknown error"}`));
        return;
      }
      if (event.type === "session.updated") {
        send({
          event_id: eventId("append"),
          type: "input_text_buffer.append",
          text: input.text
        });
        send({
          event_id: eventId("commit"),
          type: "input_text_buffer.commit"
        });
        return;
      }
      if (event.type === "response.audio.delta" && typeof event.delta === "string") {
        audioChunks.push(Buffer.from(event.delta, "base64"));
        return;
      }
      if (event.type === "response.done") {
        send({
          event_id: eventId("finish"),
          type: "session.finish"
        });
        return;
      }
      if (event.type === "session.finished") {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          ws.close();
          resolve();
        }
      }
    });

    ws.on("error", (error) => {
      fail(error instanceof Error ? error : new Error(String(error)));
    });
  });

  const pcm = Buffer.concat(audioChunks);
  if (pcm.length === 0) {
    throw new Error("Qwen realtime cloned TTS returned no audio.");
  }
  return wavFromPcm16Mono(pcm, 24000);
}

function wavFromPcm16Mono(pcm: Buffer, sampleRate = 24000) {
  if (pcm.subarray(0, 4).toString("ascii") === "RIFF") return pcm;
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  const blockAlign = 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function eventId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
