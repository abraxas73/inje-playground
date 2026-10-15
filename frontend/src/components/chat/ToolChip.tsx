"use client";

import { useState } from "react";
import { CheckCircle2, ChevronRight, Loader2, XCircle } from "lucide-react";
import { toolLabel } from "@/lib/chat/summary";
import type { ToolView } from "@/lib/chat/view";

const WHERE: Record<string, string> = { server: "서버", "desktop-relay": "아마란스(데스크톱 앱)", device: "앱" };

/** 도구 호출 한 줄 — 무엇을·어디서. 펼치면 요약(결과 원문은 저장하지 않는다). */
export default function ToolChip({ tool }: { tool: ToolView }) {
  const [open, setOpen] = useState(false);
  const Icon = tool.status === "running" ? Loader2 : tool.status === "ok" ? CheckCircle2 : XCircle;
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 px-2.5 py-1 text-muted-foreground hover:text-foreground">
        <Icon className={`h-3.5 w-3.5 ${tool.status === "running" ? "animate-spin" : tool.status === "ok" ? "text-emerald-600" : "text-destructive"}`} />
        <span>{toolLabel(tool.tool)} · {WHERE[tool.location ?? "server"]}</span>
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && tool.summary && <p className="mt-1 ml-3 text-muted-foreground">{tool.summary}</p>}
    </div>
  );
}
