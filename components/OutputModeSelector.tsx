"use client";

import { FileText, Music, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OutputMode } from "@/lib/validation";
import { supportsAudioTarget } from "@/lib/languages";
import { cn } from "@/lib/utils";

type OutputModeSelectorProps = {
  value: OutputMode;
  targetLang: string;
  fileType?: "audio" | "video";
  disabled?: boolean;
  onChange: (value: OutputMode) => void;
};

const modes = [
  { value: "text", label: "Transcript", icon: FileText },
  { value: "text_audio", label: "Transcript + audio", icon: Music },
  { value: "text_audio_video", label: "Transcript + video", icon: Video }
] as const;

export function OutputModeSelector({ value, targetLang, fileType, disabled, onChange }: OutputModeSelectorProps) {
  const audioSupported = supportsAudioTarget(targetLang);
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {modes.map((mode) => {
        const Icon = mode.icon;
        const unavailable =
          disabled ||
          (mode.value !== "text" && !audioSupported) ||
          (mode.value === "text_audio_video" && fileType !== "video");
        return (
          <Button
            key={mode.value}
            type="button"
            variant={value === mode.value ? "default" : "outline"}
            className={cn("h-12 justify-start", value === mode.value && "shadow-sm")}
            onClick={() => onChange(mode.value)}
            disabled={unavailable}
          >
            <Icon className="h-4 w-4" />
            {mode.label}
          </Button>
        );
      })}
    </div>
  );
}
