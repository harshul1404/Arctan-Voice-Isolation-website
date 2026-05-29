export type SilenceSpan = {
  start: number;
  end: number;
};

export type SpeechSegment = {
  index: number;
  start: number;
  end: number;
  duration: number;
  speakerId?: string;
  sourceText?: string;
};

export function buildSpeechSegmentsFromSilences(duration: number, silences: SilenceSpan[], padding = 0.08) {
  const segments: SpeechSegment[] = [];
  let cursor = 0;

  for (const silence of silences) {
    const end = Math.max(0, silence.start - padding);
    if (end - cursor >= 0.35) {
      segments.push({
        index: segments.length,
        start: cursor,
        end,
        duration: end - cursor
      });
    }
    cursor = Math.min(duration, silence.end + padding);
  }

  if (duration - cursor >= 0.35) {
    segments.push({
      index: segments.length,
      start: cursor,
      end: duration,
      duration: duration - cursor
    });
  }

  return segments;
}

export function parseSilencedetectOutput(output: string) {
  const starts: number[] = [];
  const silences: SilenceSpan[] = [];

  for (const line of output.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      starts.push(Number(startMatch[1]));
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch) {
      const start = starts.shift();
      if (typeof start === "number") {
        silences.push({ start, end: Number(endMatch[1]) });
      }
    }
  }

  return silences;
}

export function buildAtempoFilter(speedRatio: number) {
  if (!Number.isFinite(speedRatio) || speedRatio <= 0) {
    throw new Error("Invalid audio speed ratio.");
  }
  const filters: string[] = [];
  let remaining = speedRatio;

  while (remaining > 2) {
    filters.push("atempo=2.000");
    remaining /= 2;
  }
  while (remaining < 0.5) {
    filters.push("atempo=0.500");
    remaining /= 0.5;
  }
  filters.push(`atempo=${remaining.toFixed(3)}`);
  return filters.join(",");
}

export function splitLongSpeechSegments(segments: SpeechSegment[], maxDuration = 8) {
  const split: SpeechSegment[] = [];
  for (const segment of segments) {
    if (segment.duration <= maxDuration) {
      split.push({ ...segment, index: split.length });
      continue;
    }
    let cursor = segment.start;
    while (segment.end - cursor > maxDuration) {
      split.push({
        index: split.length,
        start: cursor,
        end: cursor + maxDuration,
        duration: maxDuration
      });
      cursor += maxDuration;
    }
    if (segment.end - cursor >= 0.35) {
      split.push({
        index: split.length,
        start: cursor,
        end: segment.end,
        duration: segment.end - cursor
      });
    }
  }
  return split;
}
