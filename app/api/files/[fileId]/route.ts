import { promises as fs } from "fs";
import { NextResponse } from "next/server";
import { assertInside, getUploadMetadata, uploadsDir } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { fileId: string } }) {
  try {
    const metadata = await getUploadMetadata(params.fileId);
    if (!metadata) {
      return NextResponse.json({ error: "File not found." }, { status: 404 });
    }
    const localPath = assertInside(uploadsDir, metadata.localPath);
    const data = await fs.readFile(localPath);
    return new NextResponse(data, {
      headers: {
        "Content-Type": metadata.mimeType,
        "Content-Disposition": `inline; filename="${metadata.originalName}"`
      }
    });
  } catch (error) {
    console.error("File read failed", error);
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
}
