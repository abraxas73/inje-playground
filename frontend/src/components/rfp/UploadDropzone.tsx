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
        // 한 줄 배치로 높이를 줄인다(예전 세로 배치 p-8 → 아이콘·문구 가로 p-3)
        "flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 text-left transition-colors",
        over ? "border-primary bg-primary/5" : "border-muted-foreground/30 hover:bg-muted/40",
        busy && "cursor-wait opacity-70",
      )}
    >
      <input ref={inputRef} type="file" accept=".hwp,.hwpx,.docx,.xlsx" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
      {busy ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" /> : <Upload className="h-5 w-5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <div className="text-sm font-medium">{busy ? phaseLabel ?? "처리 중…" : "제안요청서 파일을 여기에 놓거나 클릭해 선택하세요"}</div>
        <div className="text-xs text-muted-foreground">hwp · hwpx · docx · xlsx, 50MB 이하 · 엑셀은 요건표(구분·No.·항목 열) 시트를 읽습니다</div>
      </div>
    </div>
  );
}
