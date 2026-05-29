import { promises as fs } from "fs";
import OpenAI from "openai";
import { nanoid } from "nanoid";
import { outputPath, publicOutputUrl, UploadMetadata } from "@/lib/storage";
import { OutputMode } from "@/lib/validation";

type TranslateWithQwenInput = {
  upload: UploadMetadata;
  inputAudioPath?: string;
  inputAudioFormat?: string;
  publicFileUrl?: string;
  sourceLang?: string;
  targetLang: string;
  outputMode: OutputMode;
  voice?: string;
};

export type QwenTranslateResult = {
  jobId: string;
  transcript: string;
  audioFilename?: string;
  audioUrl?: string;
  usage?: unknown;
};

export function wavFromPcm16Mono(pcm: Buffer, sampleRate = 24000) {
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

function getClient() {
  if (!process.env.DASHSCOPE_API_KEY) {
    throw new Error("Missing DASHSCOPE_API_KEY.");
  }
  return new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    baseURL: process.env.DASHSCOPE_BASE_URL || "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
  });
}

export async function translateWithQwen(input: TranslateWithQwenInput): Promise<QwenTranslateResult> {
  const wantsAudio = input.outputMode !== "text";
  const modalities = wantsAudio ? ["text", "audio"] : ["text"];
  const content =
    input.upload.fileType === "audio" || input.inputAudioPath
      ? [
          {
            type: "input_audio",
            input_audio: {
              data: `data:audio/${input.inputAudioFormat ?? input.upload.extension};base64,${(await fs.readFile(
                input.inputAudioPath ?? input.upload.localPath
              )).toString("base64")}`,
              format: input.inputAudioFormat ?? input.upload.extension
            }
          }
        ]
      : [
          {
            type: "video_url",
            video_url: {
              url: input.publicFileUrl
            }
          }
        ];

  const translationOptions: Record<string, string> = {
    target_lang: input.targetLang
  };
  if (input.sourceLang && input.sourceLang !== "auto") {
    translationOptions.source_lang = input.sourceLang;
  }

  const request: Record<string, unknown> = {
    model: "qwen3-livetranslate-flash",
    messages: [
      {
        role: "user",
        content
      }
    ],
    modalities,
    stream: true,
    stream_options: { include_usage: true },
    translation_options: translationOptions
  };

  if (wantsAudio) {
    request.audio = { voice: input.voice, format: "wav" };
  }

  const stream = (await getClient().chat.completions.create(request as any)) as unknown as AsyncIterable<any>;
  let transcript = "";
  let audioBase64 = "";
  let usage: unknown;

  try {
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === "string") {
        transcript += delta.content;
      }
      if (typeof delta?.audio?.data === "string") {
        audioBase64 += delta.audio.data;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
    }
  } catch (error) {
    console.error("Qwen stream interrupted", error);
    throw new Error("Streaming interrupted while receiving the translation.");
  }

  const jobId = nanoid(16);
  if (!wantsAudio) {
    return { jobId, transcript, usage };
  }
  if (!audioBase64) {
    console.warn(`[qwen-translate] No audio data returned (transcript: "${transcript.slice(0, 120)}")`);
    return { jobId, transcript, usage };
  }

  const audioFilename = `${jobId}.wav`;
  await fs.writeFile(outputPath(audioFilename), wavFromPcm16Mono(Buffer.from(audioBase64, "base64")));

  return {
    jobId,
    transcript,
    audioFilename,
    audioUrl: publicOutputUrl(audioFilename),
    usage
  };
}

export async function translateAudioFileWithQwen(input: {
  audioPath: string;
  audioFormat: string;
  sourceLang?: string;
  targetLang: string;
  voice: string;
}) {
  const translationOptions: Record<string, string> = {
    target_lang: input.targetLang
  };
  if (input.sourceLang && input.sourceLang !== "auto") {
    translationOptions.source_lang = input.sourceLang;
  }
  const request: Record<string, unknown> = {
    model: "qwen3-livetranslate-flash",
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: `data:audio/${input.audioFormat};base64,${(await fs.readFile(input.audioPath)).toString("base64")}`,
              format: input.audioFormat
            }
          }
        ]
      }
    ],
    modalities: ["text", "audio"],
    audio: { voice: input.voice, format: "wav" },
    stream: true,
    stream_options: { include_usage: true },
    translation_options: translationOptions
  };

  const stream = (await getClient().chat.completions.create(request as any)) as unknown as AsyncIterable<any>;
  let transcript = "";
  let audioBase64 = "";
  let usage: unknown;

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta;
    if (typeof delta?.content === "string") transcript += delta.content;
    if (typeof delta?.audio?.data === "string") audioBase64 += delta.audio.data;
    if (chunk.usage) usage = chunk.usage;
  }
  if (!audioBase64) {
    // The API can return text-only (no audio) for very short phrases, background
    // noise sections, or when the model decides the segment has nothing to dub.
    // Return an empty audio buffer — the caller will try a TTS fallback or skip.
    console.warn(
      `[qwen-translate] Segment returned no audio data ` +
        `(transcript: "${transcript.slice(0, 120)}")`
    );
    return { transcript, audio: Buffer.alloc(0), usage };
  }
  return {
    transcript,
    audio: wavFromPcm16Mono(Buffer.from(audioBase64, "base64")),
    usage
  };
}

export async function translateTextWithQwen(input: {
  text: string;
  sourceLang?: string;
  targetLang: string;
}) {
  const model = process.env.QWEN_TEXT_TRANSLATION_MODEL || "qwen-plus";
  const source = input.sourceLang && input.sourceLang !== "auto" ? input.sourceLang : "auto-detect";
  const prompt = [
    "Translate the following source text for a dubbed video.",
    "Return only the complete translated text. Do not add notes, labels, markdown, or quotation marks.",
    "Keep numbers and technical meaning accurate. Use natural spoken wording.",
    "Each segment must stand on its own as a complete spoken English line when possible.",
    "If the source starts with a connective such as where, and, or but, rewrite it into a complete clause instead of starting with the connective.",
    `Source language: ${source}`,
    `Target language: ${input.targetLang}`,
    "",
    input.text
  ].join("\n");

  const completion = await getClient().chat.completions.create({
    model,
    messages: [
      {
        role: "user",
        content: prompt
      }
    ],
    temperature: 0.1
  } as any);

  const translated = completion.choices?.[0]?.message?.content;
  if (typeof translated !== "string" || !translated.trim()) {
    throw new Error("Qwen text translation returned an empty response.");
  }

  return {
    transcript: translated.trim().replace(/^["“”']|["“”']$/g, ""),
    usage: completion.usage
  };
}
