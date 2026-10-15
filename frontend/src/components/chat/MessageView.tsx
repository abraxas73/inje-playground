"use client";

import ReactMarkdown from "react-markdown";
import { Paperclip, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ToolChip from "./ToolChip";
import type { ViewMessage } from "@/lib/chat/view";

/** 말풍선 하나 — 사용자는 오른쪽 평문, 이노봇은 왼쪽 마크다운 + 도구 칩. */
export default function MessageView({ message: m, onRetry }: { message: ViewMessage; onRetry?: () => void }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}>
        {m.tools.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tools.map((t) => <ToolChip key={t.id} tool={t} />)}</div>}
        {m.attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{m.attachments.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded bg-background/20 px-2 py-0.5 text-xs"><Paperclip className="h-3 w-3" />{a.name}</span>)}</div>}
        {mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p>
          : m.text ? <div className="prose prose-sm max-w-none break-words dark:prose-invert"><ReactMarkdown>{m.text}</ReactMarkdown></div>
          : m.status === "streaming" ? <p className="text-muted-foreground" role="status">생각하는 중…</p> : null}
        {m.masked > 0 && <p className={`inline-flex items-center gap-1 text-xs ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}><ShieldCheck className="h-3.5 w-3.5" />개인정보 {m.masked}건 가림</p>}
        {m.status === "stopped" && <p className="text-xs text-muted-foreground">중지됨</p>}
        {m.status === "failed" && <div className="flex items-center gap-2 text-xs text-destructive">답하지 못했습니다.{onRetry && <Button size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>}</div>}
      </div>
    </div>
  );
}
