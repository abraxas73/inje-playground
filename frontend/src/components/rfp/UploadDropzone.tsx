"use client";

import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  busy: boolean;
  phaseLabel?: string;
  onFile: (file: File) => void;
}

export default function UploadDropzone({ busy, phaseLabel, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-busy={busy}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && !busy) inputRef.current?.click(); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) pick(e.dataTransfer.files); }}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-center transition-colors",
        over ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:bg-muted/40",
        busy && "cursor-wait opacity-70",
      )}
    >
      <input ref={inputRef} type="file" accept=".hwp,.hwpx,.docx" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      {busy ? <Loader2 className="h-8 w-8 animate-spin text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground" />}
      <div className="font-medium">{busy ? phaseLabel ?? "처리 중…" : "제안요청서 파일을 여기에 놓거나 클릭해 선택하세요"}</div>
      <div className="text-xs text-muted-foreground">hwp · hwpx · docx, 50MB 이하. 올리면 프로젝트를 등록하고 요구사항을 추출합니다.</div>
    </div>
  );
}
