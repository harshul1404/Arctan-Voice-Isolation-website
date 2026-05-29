import { NextResponse } from "next/server";
import { saveUpload } from "@/lib/storage";
import { normalizeExtension, validateUploadFile } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
    }
    const extension = normalizeExtension(file.name);
    const validationError = validateUploadFile(file, extension);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const metadata = await saveUpload(file);
    const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
    return NextResponse.json({
      fileId: metadata.fileId,
      originalName: metadata.originalName,
      mimeType: metadata.mimeType,
      extension: metadata.extension,
      localPath: metadata.localPath,
      fileType: metadata.fileType,
      publicUrl: publicBaseUrl ? `${publicBaseUrl}/api/files/${metadata.fileId}` : undefined
    });
  } catch (error) {
    console.error("Upload failed", error);
    return NextResponse.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }
}
