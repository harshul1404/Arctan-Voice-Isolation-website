export const languages = [
  { code: "auto", label: "Auto detect" },
  { code: "en", label: "English" },
  { code: "zh", label: "Chinese" },
  { code: "ru", label: "Russian" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "ko", label: "Korean" },
  { code: "ja", label: "Japanese" },
  { code: "yue", label: "Cantonese" },
  { code: "id", label: "Indonesian" },
  { code: "vi", label: "Vietnamese" },
  { code: "th", label: "Thai" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
  { code: "el", label: "Greek" },
  { code: "tr", label: "Turkish" }
] as const;

export const targetLanguages = languages.filter((language) => language.code !== "auto");

export const audioTargetLanguages = new Set([
  "en",
  "zh",
  "ru",
  "fr",
  "de",
  "pt",
  "es",
  "it",
  "ko",
  "ja",
  "yue"
]);

export const textOnlyTargetLanguages = new Set(["id", "vi", "th", "ar", "hi", "el", "tr"]);

export const voices = ["Cherry", "Nofish", "Jada", "Dylan", "Sunny", "Peter", "Kiki", "Eric"] as const;

export type Voice = (typeof voices)[number];

const multilingualVoices = new Set(["Cherry", "Nofish"]);
const chineseOnlyVoices = new Set(["Jada", "Dylan", "Sunny", "Peter", "Eric"]);

export function supportsAudioTarget(targetLang: string) {
  return audioTargetLanguages.has(targetLang);
}

export function isVoiceCompatible(voice: string | undefined, targetLang: string) {
  if (!voice) return false;
  if (multilingualVoices.has(voice)) {
    return ["zh", "en", "fr", "de", "ru", "it", "es", "pt", "ja", "ko"].includes(targetLang);
  }
  if (chineseOnlyVoices.has(voice)) return targetLang === "zh";
  if (voice === "Kiki") return targetLang === "yue";
  return false;
}

export function compatibleVoices(targetLang: string) {
  return voices.filter((voice) => isVoiceCompatible(voice, targetLang));
}

export function languageLabel(code: string) {
  return languages.find((language) => language.code === code)?.label ?? code;
}
