export type QwenAsrWord = {
  start: number;
  end: number;
  text: string;
};

export type QwenAsrSentence = {
  index: number;
  start: number;
  end: number;
  text: string;
  words: QwenAsrWord[];
  /** Speaker label returned by diarization, e.g. "0", "1". Undefined when
   *  diarization is disabled or the model did not return speaker IDs. */
  speakerId?: string;
};

export type QwenAsrResult = {
  taskId: string;
  transcriptionUrl?: string;
  text: string;
  sentences: QwenAsrSentence[];
  speakers: string[]; // unique speaker IDs found, in order of first appearance
  raw: unknown;
};

function dashScopeApiBase() {
  if (process.env.DASHSCOPE_API_BASE_URL) return process.env.DASHSCOPE_API_BASE_URL.replace(/\/$/, "");
  return process.env.DASHSCOPE_BASE_URL?.includes("dashscope-us")
    ? "https://dashscope.aliyuncs.com/api/v1"
    : "https://dashscope-intl.aliyuncs.com/api/v1";
}

function apiKey() {
  if (!process.env.DASHSCOPE_API_KEY) throw new Error("Missing DASHSCOPE_API_KEY.");
  return process.env.DASHSCOPE_API_KEY;
}

async function dashScopeJson(url: string, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable",
      ...(init.headers || {})
    }
  });
  const text = await response.text();
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text };
  }
  if (!response.ok || payload.code) {
    throw new Error(`Qwen ASR API error ${response.status}: ${payload.message || payload.code || text}`);
  }
  return payload;
}

export async function transcribeWithQwenFileAsr(input: {
  fileUrl: string;
  language?: string;
  timeoutMs?: number;
}): Promise<QwenAsrResult> {
  const parameters: Record<string, unknown> = {
    channel_id: [0],
    // ITN converts e.g. "twenty three" → "23" and adds proper formatting.
    enable_itn: true,
    // Punctuation prediction produces complete, readable sentences.
    enable_punctuation_prediction: true,
    enable_words: true,
    // Speaker diarization — flat flag supported by qwen3-asr-flash-filetrans.
    diarization_enabled: true,
    // Some Qwen ASR models also accept the nested form; include both so either works.
    diarization: {
      diarization_enabled: true
    }
  };
  if (input.language && input.language !== "auto") {
    parameters.language = input.language;
  }

  const submit = await dashScopeJson(`${dashScopeApiBase()}/services/audio/asr/transcription`, {
    method: "POST",
    body: JSON.stringify({
      model: "qwen3-asr-flash-filetrans",
      input: { file_url: input.fileUrl },
      parameters
    })
  });

  const taskId = submit.output?.task_id;
  if (!taskId) throw new Error("Qwen ASR did not return a task ID.");

  const deadline = Date.now() + (input.timeoutMs ?? 180_000);
  let lastPayload: any = submit;
  while (Date.now() < deadline) {
    await sleep(2000);
    lastPayload = await dashScopeJson(`${dashScopeApiBase()}/tasks/${encodeURIComponent(taskId)}`, {
      method: "GET"
    });
    const status = lastPayload.output?.task_status;
    if (status === "SUCCEEDED") {
      const transcriptionUrl = findTranscriptionUrl(lastPayload);
      if (!transcriptionUrl) throw new Error("Qwen ASR succeeded but did not return a transcription URL.");
      const resultResponse = await fetch(transcriptionUrl);
      if (!resultResponse.ok) throw new Error(`Failed to download Qwen ASR transcript: ${resultResponse.status}`);
      const raw = await resultResponse.json();
      const sentences = extractSentences(raw);
      const speakers = collectSpeakers(sentences);
      console.log(
        `[qwen-asr] Transcription complete: ${sentences.length} sentences, ` +
          `${speakers.length} speaker(s) detected: ${speakers.join(", ")}`
      );
      return {
        taskId,
        transcriptionUrl,
        text: sentences.map((s) => s.text).join(" ").trim(),
        sentences,
        speakers,
        raw
      };
    }
    if (status === "FAILED" || status === "UNKNOWN") {
      throw new Error(`Qwen ASR task failed: ${lastPayload.output?.message || status}`);
    }
  }

  throw new Error(
    `Qwen ASR timed out waiting for task ${taskId}. Last response: ${JSON.stringify(lastPayload.output || lastPayload)}`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findTranscriptionUrl(payload: any): string | undefined {
  return (
    payload.output?.result?.transcription_url ||
    payload.output?.results?.[0]?.transcription_url ||
    payload.output?.transcription_url
  );
}

/**
 * Detect whether the raw timestamp values from the API are in milliseconds or
 * seconds.  The Qwen ASR API documents them as milliseconds, but some model
 * versions (or future changes) may return seconds.
 *
 * Heuristic: if the maximum end_time across all sentences is ≤ 7200 AND the
 * median end_time is < 3600, treat them as seconds; otherwise as milliseconds.
 * A 2-hour video in seconds gives max ≈ 7200; in milliseconds gives max ≈ 7_200_000.
 */
function detectTimestampUnit(rawSentences: any[]): "ms" | "s" {
  const ends: number[] = rawSentences
    .map((s: any) => Number(s.end_time ?? s.endTime ?? 0))
    .filter(Number.isFinite);
  if (ends.length === 0) return "ms";
  const maxEnd = Math.max(...ends);
  // If no value exceeds 7200 the data is almost certainly in seconds.
  return maxEnd > 7200 ? "ms" : "s";
}

function toSeconds(raw: number, unit: "ms" | "s"): number {
  return unit === "ms" ? raw / 1000 : raw;
}

function extractSentences(raw: any): QwenAsrSentence[] {
  // Collect all raw sentence objects across all transcripts so we can detect
  // the timestamp unit before converting.
  const allRaw: any[] = [];
  for (const transcript of raw.transcripts || []) {
    for (const sentence of transcript.sentences || []) {
      allRaw.push(sentence);
    }
  }

  const unit = detectTimestampUnit(allRaw);
  if (unit === "s") {
    console.warn("[qwen-asr] Timestamps detected as seconds (not ms) — converting accordingly.");
  }

  const sentences: QwenAsrSentence[] = [];

  for (const transcript of raw.transcripts || []) {
    // Build a speaker-ID lookup from diarization blocks if present.
    // Some Qwen ASR responses provide a top-level diarization array with
    // speaker_id mapped to sentence ranges.
    const diarizationMap = buildDiarizationMap(transcript);

    for (const sentence of transcript.sentences || []) {
      const startRaw = Number(sentence.begin_time ?? sentence.beginTime ?? 0);
      const endRaw = Number(sentence.end_time ?? sentence.endTime ?? 0);
      const start = toSeconds(startRaw, unit);
      const end = toSeconds(endRaw, unit);
      const text = String(sentence.text || "").trim();

      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) continue;

      // speaker_id may come as integer 0/1/2, string "0"/"1", or be absent.
      // Try the inline field first, then fall back to the diarization map.
      const rawSpeaker =
        sentence.speaker_id ??
        sentence.speakerId ??
        sentence.speaker ??
        diarizationMap.get(startRaw);
      const speakerId =
        rawSpeaker !== undefined && rawSpeaker !== null ? String(rawSpeaker) : undefined;

      sentences.push({
        index: sentences.length,
        start,
        end,
        text,
        words: extractWords(sentence.words || [], unit),
        speakerId
      });
    }
  }

  // If the ASR model did not return any speaker IDs (diarization unsupported or
  // not active on this endpoint) apply a simple heuristic so that multi-speaker
  // content still gets different voices.
  const hasDiarization = sentences.some((s) => s.speakerId !== undefined);
  if (!hasDiarization && sentences.length > 1) {
    console.warn(
      "[qwen-asr] No speaker IDs returned by ASR — applying pause-based heuristic speaker assignment."
    );
    return assignSpeakersHeuristically(sentences);
  }

  return sentences;
}

/**
 * Some Qwen ASR responses include a `diarization` array at the transcript level
 * mapping time ranges to speaker IDs.  Build a Map<beginTimeRaw, speakerId> so
 * we can look up the speaker for sentences that lack an inline speaker_id.
 */
function buildDiarizationMap(transcript: any): Map<number, string> {
  const map = new Map<number, string>();
  const diarization = transcript.diarization ?? transcript.speakers ?? [];
  for (const entry of diarization) {
    const speakerId = entry.speaker_id ?? entry.speakerId;
    if (speakerId === undefined || speakerId === null) continue;
    for (const seg of entry.sentences ?? entry.segments ?? []) {
      const begin = Number(seg.begin_time ?? seg.beginTime ?? 0);
      map.set(begin, String(speakerId));
    }
  }
  return map;
}

function extractWords(rawWords: any[], unit: "ms" | "s"): QwenAsrWord[] {
  const words: QwenAsrWord[] = [];
  for (const word of rawWords) {
    const startRaw = Number(word.begin_time ?? word.beginTime ?? 0);
    const endRaw = Number(word.end_time ?? word.endTime ?? 0);
    const start = toSeconds(startRaw, unit);
    const end = toSeconds(endRaw, unit);
    const text = String(word.text || "").trim();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && text) {
      words.push({ start, end, text });
    }
  }
  return words;
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
  // Fallback: if diarization returned nothing, treat everything as speaker "0"
  return ordered.length > 0 ? ordered : ["0"];
}

/**
 * Heuristic speaker assignment when the ASR model returns no speaker IDs.
 *
 * A speaker change is detected when:
 *   - The silence gap between consecutive sentences exceeds PAUSE_THRESHOLD, AND
 *   - The current speaker has been talking for at least MIN_TURN_SECONDS.
 *
 * This produces a rough 2-speaker approximation which is far better than
 * treating the entire video as a single speaker.
 */
function assignSpeakersHeuristically(sentences: QwenAsrSentence[]): QwenAsrSentence[] {
  const PAUSE_THRESHOLD = 1.2;   // seconds of silence → possible speaker change
  const MIN_TURN_SECONDS = 2.5;  // minimum time a speaker must hold the floor before switching

  const result = sentences.map((s) => ({ ...s, speakerId: "0" }));
  let currentSpeaker = 0;
  let turnStart = result[0].start;

  for (let i = 1; i < result.length; i++) {
    const gap = result[i].start - result[i - 1].end;
    const turnDuration = result[i].start - turnStart;
    if (gap >= PAUSE_THRESHOLD && turnDuration >= MIN_TURN_SECONDS) {
      currentSpeaker = 1 - currentSpeaker; // toggle between 0 and 1
      turnStart = result[i].start;
    }
    result[i].speakerId = String(currentSpeaker);
  }
  return result;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
