"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import Composer from "@/components/chat/Composer";
import { DRAFT_KEY, SUGGESTIONS } from "@/lib/chat/view";

/** 홈 맨 위 채팅 입력창 — 보내면 /chat이 이어받아 새 대화를 만든다(질문은 sessionStorage로 넘기고 URL에 싣지 않는다). */
export default function HomeChatBox() {
  const router = useRouter();
  const [models, setModels] = useState<string[]>(["claude-sonnet-5-5"]);
  const [model, setModel] = useState("claude-sonnet-5-5");
  useEffect(() => {
    fetch("/api/chat/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c?.models) { setModels(c.models); setModel(c.defaultModel); } }).catch(() => {});
  }, []);
  const go = (text: string, attachments: Array<{ id: string; name: string }>) => {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ text, attachments, model })); } catch { /* 저장소 막힘 — 빈 채팅으로 간다 */ }
    router.push("/chat");
  };
  return (
    <section aria-label="이노봇에게 묻기" className="mb-6 space-y-3">
      <Composer busy={false} models={models} model={model} onModel={setModel} onSend={go} />
      <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => go(s, [])}>{s}</Button>)}</div>
    </section>
  );
}
