"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { TranscriptPhrase } from "@/lib/alignedDubbing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// ── Timestamp helpers ─────────────────────────────────────────────────────

/** Seconds → MM:SS.S display string */
function fmtTs(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const frac = Math.round((s - Math.floor(s)) * 10);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${frac}`;
}

/**
 * Parse user-entered timestamp to seconds.
 * Accepts: MM:SS.S · MM:SS · SS.S · SS
 * Returns null when the string is not parseable.
 */
function parseTs(raw: string): number | null {
  const s = raw.trim();
  const colonFmt = s.match(/^(\d+):(\d{1,2})(?:\.(\d+))?$/);
  if (colonFmt) {
    const mins = parseInt(colonFmt[1], 10);
    const secs = parseInt(colonFmt[2], 10);
    const frac = colonFmt[3] ? parseFloat(`0.${colonFmt[3]}`) : 0;
    const total = mins * 60 + secs + frac;
    return total >= 0 ? total : null;
  }
  const plain = parseFloat(s);
  return !isNaN(plain) && plain >= 0 ? plain : null;
}

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  phrases: TranscriptPhrase[];
  disabled?: boolean;
  onChange: (updated: TranscriptPhrase[]) => void;
}

export function TranscriptEditor({ phrases, disabled = false, onChange }: Props) {
  /**
   * tsEditing: tracks the raw string while a timestamp input is focused.
   * key format: `${phrase.index}-start` | `${phrase.index}-end`
   */
  const [tsEditing, setTsEditing] = useState<Record<string, string>>({});
  const [tsError, setTsError] = useState<Record<string, string>>({});

  // ── Mutation helpers ────────────────────────────────────────────────────

  function updatePhrase(index: number, patch: Partial<TranscriptPhrase>) {
    onChange(phrases.map((p) => (p.index === index ? { ...p, ...patch } : p)));
  }

  function deletePhrase(index: number) {
    onChange(phrases.filter((p) => p.index !== index));
  }

  /**
   * Insert a new empty phrase.
   * afterIndex — phrase.index of the phrase to insert after; omit to append.
   */
  function addPhraseAfter(afterIndex?: number) {
    const maxIdx = phrases.reduce((m, p) => Math.max(m, p.index), -1);
    const insertPos =
      afterIndex !== undefined
        ? phrases.findIndex((p) => p.index === afterIndex) + 1
        : phrases.length;

    const prev = insertPos > 0 ? phrases[insertPos - 1] : null;
    const next = insertPos < phrases.length ? phrases[insertPos] : null;

    const rawStart = prev ? prev.end + 0.1 : 0;
    const rawEnd = next
      ? Math.min(rawStart + 3, next.start - 0.1)
      : rawStart + 3;

    const start = Math.round(rawStart * 10) / 10;
    const end = Math.max(Math.round(rawEnd * 10) / 10, start + 0.5);

    const newPhrase: TranscriptPhrase = {
      index: maxIdx + 1,
      start,
      end,
      speakerId: prev?.speakerId ?? "0",
      translatedText: ""
    };

    const updated = [...phrases];
    updated.splice(insertPos, 0, newPhrase);
    onChange(updated);
  }

  // ── Timestamp input handlers ────────────────────────────────────────────

  function startTsEdit(phraseIndex: number, field: "start" | "end", current: number) {
    const key = `${phraseIndex}-${field}`;
    setTsEditing((prev) => ({ ...prev, [key]: fmtTs(current) }));
    setTsError((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  function commitTsEdit(phraseIndex: number, field: "start" | "end") {
    const key = `${phraseIndex}-${field}`;
    const raw = tsEditing[key];
    if (raw === undefined) return; // not editing

    const seconds = parseTs(raw);
    if (seconds === null) {
      setTsError((prev) => ({ ...prev, [key]: "Use MM:SS.S" }));
      return;
    }

    const phrase = phrases.find((p) => p.index === phraseIndex);
    if (!phrase) return;

    if (field === "start" && seconds >= phrase.end) {
      setTsError((prev) => ({ ...prev, [key]: "Must be before end" }));
      return;
    }
    if (field === "end" && seconds <= phrase.start) {
      setTsError((prev) => ({ ...prev, [key]: "Must be after start" }));
      return;
    }

    updatePhrase(phraseIndex, { [field]: seconds });
    setTsEditing((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setTsError((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (phrases.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">No phrases yet.</p>
        {!disabled && (
          <Button size="sm" variant="outline" onClick={() => addPhraseAfter()}>
            <Plus className="h-3.5 w-3.5" /> Add Phrase
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {phrases.map((phrase, i) => {
        const startKey = `${phrase.index}-start`;
        const endKey = `${phrase.index}-end`;

        return (
          <div key={phrase.index}>
            {/* ── Phrase card ── */}
            <div className="rounded-lg border bg-card p-3 space-y-2.5">
              {/* Header */}
              <div className="flex flex-wrap items-end gap-2">
                {/* Start timestamp */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Start
                  </span>
                  <Input
                    value={tsEditing[startKey] !== undefined ? tsEditing[startKey] : fmtTs(phrase.start)}
                    disabled={disabled}
                    className={`h-7 w-[88px] font-mono text-xs ${tsError[startKey] ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    onFocus={() => startTsEdit(phrase.index, "start", phrase.start)}
                    onChange={(e) =>
                      setTsEditing((prev) => ({ ...prev, [startKey]: e.target.value }))
                    }
                    onBlur={() => commitTsEdit(phrase.index, "start")}
                    onKeyDown={(e) => { if (e.key === "Enter") commitTsEdit(phrase.index, "start"); }}
                  />
                  {tsError[startKey] && (
                    <span className="text-[10px] text-destructive leading-none">{tsError[startKey]}</span>
                  )}
                </div>

                <span className="mb-1.5 text-muted-foreground">→</span>

                {/* End timestamp */}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    End
                  </span>
                  <Input
                    value={tsEditing[endKey] !== undefined ? tsEditing[endKey] : fmtTs(phrase.end)}
                    disabled={disabled}
                    className={`h-7 w-[88px] font-mono text-xs ${tsError[endKey] ? "border-destructive focus-visible:ring-destructive" : ""}`}
                    onFocus={() => startTsEdit(phrase.index, "end", phrase.end)}
                    onChange={(e) =>
                      setTsEditing((prev) => ({ ...prev, [endKey]: e.target.value }))
                    }
                    onBlur={() => commitTsEdit(phrase.index, "end")}
                    onKeyDown={(e) => { if (e.key === "Enter") commitTsEdit(phrase.index, "end"); }}
                  />
                  {tsError[endKey] && (
                    <span className="text-[10px] text-destructive leading-none">{tsError[endKey]}</span>
                  )}
                </div>

                {/* Speaker badge */}
                <span className="mb-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                  Speaker {phrase.speakerId}
                </span>

                {/* Phrase number */}
                <span className="mb-1.5 ml-auto text-[11px] text-muted-foreground">
                  #{i + 1}
                </span>

                {/* Delete button */}
                {!disabled && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="mb-0.5 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                    title="Delete this phrase"
                    onClick={() => deletePhrase(phrase.index)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>

              {/* Editable translated text */}
              <Textarea
                value={phrase.translatedText}
                disabled={disabled}
                rows={2}
                className="resize-none text-sm"
                placeholder="Translated text…"
                onChange={(e) => updatePhrase(phrase.index, { translatedText: e.target.value })}
              />
            </div>

            {/* ── Insert-between button ── */}
            {!disabled && i < phrases.length - 1 && (
              <div className="flex justify-center py-0.5">
                <button
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                  title="Insert a phrase here"
                  onClick={() => addPhraseAfter(phrase.index)}
                >
                  <Plus className="h-3 w-3" />
                  insert
                </button>
              </div>
            )}
          </div>
        );
      })}

      {/* ── Append button ── */}
      {!disabled && (
        <Button
          size="sm"
          variant="outline"
          className="mt-1 w-full gap-1.5"
          onClick={() => addPhraseAfter()}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Phrase
        </Button>
      )}
    </div>
  );
}
