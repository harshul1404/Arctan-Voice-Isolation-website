"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";
import { FileAudio, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { audioExtensions, inferFileType, normalizeExtension, videoExtensions } from "@/lib/validation";
import { cn } from "@/lib/utils";

type UploadedFile = {
  fileId: string;
  originalName: string;
  mimeType: string;
  extension: string;
  localPath: string;
  fileType: "audio" | "video";
  publicUrl?: string;
};

type FileUploadProps = {
  maxUploadMb: number;
  uploadedFile: UploadedFile | null;
  disabled?: boolean;
  onUploaded: (file: UploadedFile) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
};

export function FileUpload({ maxUploadMb, uploadedFile, disabled, onUploaded, onError, onStatus }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  async function uploadFile(file: File) {
    const extension = normalizeExtension(file.name);
    if (!inferFileType(extension)) {
      onError("Unsupported file type. Upload WAV, MP3, M4A, MP4, MOV, or WEBM.");
      return;
    }
    if (file.size > maxUploadMb * 1024 * 1024) {
      onError(`File is too large. The limit is ${maxUploadMb} MB.`);
      return;
    }
    onError("");
    onStatus("Uploading");
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error ?? "Upload failed.");
    }
    onUploaded(payload);
  }

  async function handleFile(file?: File) {
    if (!file || disabled) return;
    try {
      await uploadFile(file);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Upload failed.");
      onStatus("");
    }
  }

  function onInputChange(event: ChangeEvent<HTMLInputElement>) {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  const Icon = uploadedFile?.fileType === "video" ? Video : FileAudio;
  const accept = [...audioExtensions, ...videoExtensions].map((ext) => `.${ext}`).join(",");

  return (
    <Card
      className={cn(
        "border-dashed transition-colors",
        isDragging && "border-primary bg-primary/5",
        disabled && "opacity-70"
      )}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      <CardContent className="flex min-h-48 flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          {uploadedFile ? <Icon className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
        </div>
        <div>
          <p className="font-medium">{uploadedFile ? uploadedFile.originalName : "Drop an audio or video file here"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            WAV, MP3, M4A, MP4, MOV, or WEBM. Max {maxUploadMb} MB.
          </p>
        </div>
        <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={onInputChange} disabled={disabled} />
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={disabled}>
          <Upload className="h-4 w-4" />
          Choose file
        </Button>
      </CardContent>
    </Card>
  );
}
