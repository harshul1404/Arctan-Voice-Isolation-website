"use client";

import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { languages, targetLanguages } from "@/lib/languages";

type LanguageSelectorProps = {
  sourceLang: string;
  targetLang: string;
  disabled?: boolean;
  onSourceChange: (value: string) => void;
  onTargetChange: (value: string) => void;
};

export function LanguageSelector({
  sourceLang,
  targetLang,
  disabled,
  onSourceChange,
  onTargetChange
}: LanguageSelectorProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Source language</Label>
        <Select value={sourceLang} onValueChange={onSourceChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {languages.map((language) => (
              <SelectItem key={language.code} value={language.code}>
                {language.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Target language</Label>
        <Select value={targetLang} onValueChange={onTargetChange} disabled={disabled}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {targetLanguages.map((language) => (
              <SelectItem key={language.code} value={language.code}>
                {language.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
