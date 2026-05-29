"use client";

import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const steps = ["Uploading", "Translating", "Receiving transcript", "Receiving audio", "Creating dubbed video", "Complete"];

type JobProgressProps = {
  current: string;
  wantsAudio: boolean;
  wantsVideo: boolean;
};

export function JobProgress({ current, wantsAudio, wantsVideo }: JobProgressProps) {
  const visibleSteps = steps.filter((step) => {
    if (step === "Receiving audio") return wantsAudio;
    if (step === "Creating dubbed video") return wantsVideo;
    return true;
  });
  const currentIndex = visibleSteps.indexOf(current);

  return (
    <div className="grid gap-3">
      {visibleSteps.map((step, index) => {
        const done = current === "Complete" || (currentIndex > -1 && index < currentIndex);
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-3 text-sm">
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-primary" />
            ) : active ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : (
              <Circle className="h-4 w-4 text-muted-foreground" />
            )}
            <span className={cn(active && "font-medium", !done && !active && "text-muted-foreground")}>{step}</span>
          </div>
        );
      })}
    </div>
  );
}
