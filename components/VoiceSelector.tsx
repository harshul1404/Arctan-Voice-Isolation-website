"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { compatibleVoices, languageLabel, voices } from "@/lib/languages";

type VoiceSelectorProps = {
  targetLang: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export function VoiceSelector({ targetLang, value, disabled, onChange }: VoiceSelectorProps) {
  const allowed = compatibleVoices(targetLang);
  return (
    <div className="space-y-2">
      <Label>Voice</Label>
      <Select value={allowed.includes(value as never) ? value : allowed[0]} onValueChange={onChange} disabled={disabled || allowed.length === 0}>
        <SelectTrigger>
          <SelectValue placeholder="Select voice" />
        </SelectTrigger>
        <SelectContent>
          {voices.map((voice) => (
            <SelectItem key={voice} value={voice} disabled={!allowed.includes(voice)}>
              {voice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Available voices are filtered for {languageLabel(targetLang)} output.
      </p>
    </div>
  );
}
