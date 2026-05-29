"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Result = {
  jobId: string;
  transcript: string;
  audioUrl?: string;
  videoUrl?: string;
};

export function ResultPreview({ result }: { result: Result | null }) {
  if (!result) return null;
  const transcriptBlob = new Blob([result.transcript], { type: "text/plain" });
  const transcriptUrl = URL.createObjectURL(transcriptBlob);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
        <CardDescription>Preview and download the generated assets.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Translated transcript</h3>
            <Button asChild size="sm" variant="outline">
              <a href={transcriptUrl} download={`${result.jobId}-transcript.txt`}>
                <Download className="h-4 w-4" />
                TXT
              </a>
            </Button>
          </div>
          <Textarea value={result.transcript} readOnly className="min-h-48 resize-y" />
        </div>
        {result.audioUrl ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Dubbed audio</h3>
              <Button asChild size="sm" variant="outline">
                <a href={result.audioUrl} download>
                  <Download className="h-4 w-4" />
                  WAV
                </a>
              </Button>
            </div>
            <audio src={result.audioUrl} controls className="w-full" />
          </div>
        ) : null}
        {result.videoUrl ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">Dubbed video</h3>
              <Button asChild size="sm" variant="outline">
                <a href={result.videoUrl} download>
                  <Download className="h-4 w-4" />
                  MP4
                </a>
              </Button>
            </div>
            <video src={result.videoUrl} controls className="aspect-video w-full rounded-md bg-black" />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
