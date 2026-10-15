"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Paperclip, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import ToolChip from "./ToolChip";
import type { ViewMessage } from "@/lib/chat/view";

// 표는 좁은 말풍선에서 가로로 넘치므로 스크롤 상자에 담는다. 링크는 새 탭. 이미지는 대체 글만.
const MD: Components = {
  table: ({ children }) => <div className="not-prose my-2 overflow-x-auto rounded-md border"><table className="w-full border-collapse text-xs">{children}</table></div>,
  th: ({ children }) => <th className="whitespace-nowrap border-b bg-muted px-2.5 py-1.5 text-left font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b px-2.5 py-1.5 align-top">{children}</td>,
  a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer" className="text-primary underline">{children}</a>,
  // 이미지는 불러오지 않는다 — 메일·문서에 심은 지시로 모델이 ![](https://외부?q=대화내용)을 쓰면 그리기만 해도 외부로 샌다
  img: ({ alt }) => <span className="text-muted-foreground">[이미지{alt ? `: ${alt}` : ""}]</span>,
};

/** 말풍선 하나 — 사용자는 오른쪽 평문, 이노봇은 왼쪽 마크다운 + 도구 칩. */
export default function MessageView({ message: m, onRetry }: { message: ViewMessage; onRetry?: () => void }) {
  const mine = m.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-2 rounded-2xl px-4 py-3 text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-muted/60"}`}>
        {m.tools.length > 0 && <div className="flex flex-wrap gap-1.5">{m.tools.map((t) => <ToolChip key={t.id} tool={t} />)}</div>}
        {m.attachments.length > 0 && <div className="flex flex-wrap gap-1.5">{m.attachments.map((a) => <span key={a.id} className="inline-flex items-center gap-1 rounded bg-background/20 px-2 py-0.5 text-xs"><Paperclip className="h-3 w-3" />{a.name}</span>)}</div>}
        {mine ? <p className="whitespace-pre-wrap break-words">{m.text}</p>
          : m.text ? <div className="prose prose-sm max-w-none break-words dark:prose-invert prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5"><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{m.text}</ReactMarkdown></div>
          : m.status === "streaming" ? <p className="text-muted-foreground" role="status">생각하는 중…</p> : null}
        {m.masked > 0 && <p className={`inline-flex items-center gap-1 text-xs ${mine ? "text-primary-foreground/80" : "text-muted-foreground"}`}><ShieldCheck className="h-3.5 w-3.5" />개인정보 {m.masked}건 가림</p>}
        {m.status === "stopped" && <p className="text-xs text-muted-foreground">중지됨</p>}
        {m.status === "failed" && <div className="flex items-center gap-2 text-xs text-destructive">답하지 못했습니다.{onRetry && <Button size="sm" variant="outline" onClick={onRetry}>다시 시도</Button>}</div>}
      </div>
    </div>
  );
}
