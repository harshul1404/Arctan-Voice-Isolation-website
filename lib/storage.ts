import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { FileType, inferFileType, normalizeExtension } from "@/lib/validation";

export type UploadMetadata = {
  fileId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  localPath: string;
  fileType: FileType;
  createdAt: string;
};

export const rootDir = process.cwd();
export const uploadsDir = path.join(rootDir, "uploads");
export const outputsDir = path.join(rootDir, "outputs");
const metadataDir = path.join(uploadsDir, ".metadata");

export async function ensureStorageDirs() {
  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(outputsDir, { recursive: true });
  await fs.mkdir(metadataDir, { recursive: true });
}

export function sanitizeFilename(name: string) {
  return name
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 120);
}

export async function saveUpload(file: File) {
  await ensureStorageDirs();
  const originalName = sanitizeFilename(file.name || "upload");
  const extension = normalizeExtension(originalName);
  const fileType = inferFileType(extension);
  if (!fileType) throw new Error("Unsupported file extension.");
  const fileId = nanoid(24);
  const storedName = `${fileId}.${extension}`;
  const localPath = path.join(uploadsDir, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(localPath, buffer);

  const metadata: UploadMetadata = {
    fileId,
    originalName,
    mimeType: file.type || "application/octet-stream",
    extension,
    localPath,
    fileType,
    createdAt: new Date().toISOString()
  };
  await fs.writeFile(metadataPath(fileId), JSON.stringify(metadata, null, 2), "utf8");
  return metadata;
}

export async function getUploadMetadata(fileId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) return null;
  try {
    const data = await fs.readFile(metadataPath(fileId), "utf8");
    const metadata = JSON.parse(data) as UploadMetadata;
    if (metadata.fileId !== fileId) return null;
    return metadata;
  } catch {
    return null;
  }
}

export function metadataPath(fileId: string) {
  return path.join(metadataDir, `${fileId}.json`);
}

export function assertInside(base: string, target: string) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(`${resolvedBase}${path.sep}`) && resolvedTarget !== resolvedBase) {
    throw new Error("Path traversal attempt blocked.");
  }
  return resolvedTarget;
}

export function outputPath(filename: string) {
  return assertInside(outputsDir, path.join(outputsDir, filename));
}

export function publicOutputUrl(filename: string) {
  return `/api/outputs/${encodeURIComponent(filename)}`;
}
