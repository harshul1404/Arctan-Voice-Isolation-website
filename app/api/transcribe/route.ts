import { NextResponse } from "next/server";
import { transcribeAndTranslate } from "@/lib/alignedDubbing";
import { getUploadMetadata } from "@/lib/storage";
import { transcribeRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const maxDuration = 300;

function safeMsg(error: unknown) {
  const m = error instanceof Error ? error.message : String(error);
  if (m.includes("DASHSCOPE_API_KEY")) return "Missing API key. Set DASHSCOPE_API_KEY.";
  if (m.includes("DEEPGRAM_API_KEY")) return "Missing Deepgram API key. Set DEEPGRAM_API_KEY.";
  if (m.includes("free tier") || m.includes("quota")) return m;
  return m || "Transcription failed.";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = transcribeRequestSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });

    const upload = await getUploadMetadata(parsed.data.fileId);
    if (!upload) return NextResponse.json({ error: "Uploaded file not found." }, { status: 404 });

    const result = await transcribeAndTranslate({
      upload,
      sourceLang: parsed.data.sourceLang,
      targetLang: parsed.data.targetLang,
      voice: parsed.data.voice
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Transcription failed", error);
    return NextResponse.json({ error: safeMsg(error) }, { status: 500 });
  }
}
