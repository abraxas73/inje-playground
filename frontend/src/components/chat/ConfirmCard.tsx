"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toolLabel } from "@/lib/chat/summary";
import type { PendingCall } from "@/lib/chat/events";

// 대상은 서버가 조회한 call.target만 쓴다 — 모델이 쓴 chat_name·space_name은 실제 대상과 다를 수 있어 보이지 않는다.
const FIELD: Record<string, string> = { text: "내용", title: "제목", markdown: "본문" };

/** 쓰기 확인 카드 — 실제로 보낼 대상·내용을 보여 주고 사용자가 고른다. id류 값은 숨긴다. */
export default function ConfirmCard({ calls, onAnswer, busy = false }: { calls: PendingCall[]; onAnswer: (approve: boolean) => void; busy?: boolean }) {
  return (
    <Card className="border-primary/40 bg-primary/5 py-3">
      <CardContent className="space-y-3 px-4">
        <p className="text-sm font-medium">이 작업을 실행할까요?</p>
        {calls.map((c) => (
          <div key={c.id} className="space-y-1 rounded-md bg-background p-3 text-sm">
            <p className="font-medium">{toolLabel(c.tool)}</p>
            {c.card ? <ul className="space-y-0.5">{c.card.map((l, i) => <li key={i} className="whitespace-pre-wrap break-words">{l}</li>)}</ul> : <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1">
              {c.target && <div className="contents"><dt className="text-muted-foreground">대상</dt><dd className="break-words">{c.target}</dd></div>}
              {Object.entries(c.input).filter(([k, v]) => FIELD[k] && typeof v === "string" && v).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{FIELD[k]}</dt><dd className="whitespace-pre-wrap break-words">{(v as string).slice(0, 2000)}</dd></div>
              ))}
            </dl>}
          </div>
        ))}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAnswer(true)}>실행</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onAnswer(false)}>취소</Button>
        </div>
      </CardContent>
    </Card>
  );
}
