import { promises as fs } from "fs";
import { QwenAsrResult, QwenAsrSentence, QwenAsrWord } from "@/lib/qwenAsr";

/**
 * Deepgram Nova-3 ASR with utterance timestamps and speaker diarization.
 *
 * Sends the local WAV directly to Deepgram's synchronous /listen endpoint
 * (no public URL required) and returns a QwenAsrResult-compatible object so
 * the rest of the pipeline works unchanged.
 *
 * The `utterances` array — one utterance per speaker turn — is used to build
 * QwenAsrSentence objects with accurate start/end timestamps and speakerId.
 */
export async function transcribeWithDeepgram(input: {
  localAudioPath: string;
  language?: string;
  timeoutMs?: number;
}): Promise<QwenAsrResult> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("Missing DEEPGRAM_API_KEY.");

  const audioData = await fs.readFile(input.localAudioPath);

  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || "nova-3",
    // diarize=true is REQUIRED for utterances to be returned by Deepgram.
    diarize: "true",
    utterances: "true",
    punctuate: "true",
    smart_format: "true",
    words: "true"
  });

  // Map common ISO-639-1 codes to Deepgram / BCP-47 equivalents.
  if (input.language && input.language !== "auto") {
    params.set("language", normalizeLanguageCode(input.language));
  }

  const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 300_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "audio/wav"
      },
      body: audioData,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Deepgram API error ${response.status}: ${text}`);
  }

  const raw = await response.json();
  return parseDeepgramResponse(raw);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert the ISO-639-1 codes we use internally to the BCP-47 tags Deepgram
 * expects.  Unknown codes are passed through unchanged — Deepgram accepts most
 * BCP-47 codes directly, and passing an unsupported code simply causes it to
 * auto-detect (which is usually fine).
 */
function normalizeLanguageCode(code: string): string {
  const map: Record<string, string> = {
    zh: "zh-CN",
    yue: "zh-HK",
    // Most other codes (en, fr, de, es, it, pt, ru, ja, ko, hi, …) are
    // accepted by Deepgram as-is.
  };
  return map[code] ?? code;
}

function parseDeepgramResponse(raw: any): QwenAsrResult {
  // Prefer utterances: each utterance is a single speaker's continuous turn,
  // timestamped precisely and labelled with a speaker index.
  const utterances: any[] = raw.results?.utterances ?? [];
  const sentences = utterancesToSentences(utterances);

  // Fallback: if no utterances (e.g. diarization disabled, empty audio) try
  // building sentences from the word-level channel alternative.
  if (sentences.length === 0) {
    const words: any[] = raw.results?.channels?.[0]?.alternatives?.[0]?.words ?? [];
    const transcript: string = raw.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    if (transcript.trim()) {
      const parsedWords = parseWords(words);
      sentences.push({
        index: 0,
        start: parsedWords[0]?.start ?? 0,
        end: parsedWords[parsedWords.length - 1]?.end ?? 0,
        text: transcript.trim(),
        words: parsedWords,
        speakerId: undefined
      });
    }
  }

  const speakers = collectSpeakers(sentences);
  const text = sentences.map((s) => s.text).join(" ").trim();

  return {
    taskId: "deepgram-sync",
    text,
    sentences,
    speakers,
    raw
  };
}

function utterancesToSentences(utterances: any[]): QwenAsrSentence[] {
  const sentences: QwenAsrSentence[] = [];
  for (const utt of utterances) {
    const start = Number(utt.start);
    const end = Number(utt.end);
    const text = String(utt.transcript || "").trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;

    const speakerId =
      utt.speaker !== undefined && utt.speaker !== null ? String(utt.speaker) : undefined;

    sentences.push({
      index: sentences.length,
      start,
      end,
      text,
      words: parseWords(utt.words ?? []),
      speakerId
    });
  }
  return sentences;
}

function parseWords(rawWords: any[]): QwenAsrWord[] {
  const out: QwenAsrWord[] = [];
  for (const w of rawWords) {
    const start = Number(w.start);
    const end = Number(w.end);
    // Prefer the punctuated form so downstream text is readable.
    const text = String(w.punctuated_word ?? w.word ?? "").trim();
    if (text && Number.isFinite(start) && Number.isFinite(end) && end > start) {
      out.push({ start, end, text });
    }
  }
  return out;
}

function collectSpeakers(sentences: QwenAsrSentence[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const s of sentences) {
    if (s.speakerId !== undefined && !seen.has(s.speakerId)) {
      seen.add(s.speakerId);
      ordered.push(s.speakerId);
    }
  }
  return ordered.length > 0 ? ordered : ["0"];
}
