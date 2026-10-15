"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toolLabel } from "@/lib/chat/summary";
import type { PendingCall } from "@/lib/chat/events";

const FIELD: Record<string, string> = { chat_name: "채팅방", text: "내용", space_name: "공간", title: "제목", markdown: "본문" };

/** 쓰기 확인 카드 — 실제로 보낼 대상·내용을 보여 주고 사용자가 고른다. id류 값은 숨긴다. */
export default function ConfirmCard({ calls, onAnswer, busy = false }: { calls: PendingCall[]; onAnswer: (approve: boolean) => void; busy?: boolean }) {
  return (
    <Card className="border-primary/40 bg-primary/5 py-3">
      <CardContent className="space-y-3 px-4">
        <p className="text-sm font-medium">이 작업을 실행할까요?</p>
        {calls.map((c) => (
          <div key={c.id} className="space-y-1 rounded-md bg-background p-3 text-sm">
            <p className="font-medium">{toolLabel(c.tool)}</p>
            <dl className="grid grid-cols-[4rem_1fr] gap-x-2 gap-y-1">
              {Object.entries(c.input).filter(([k, v]) => FIELD[k] && typeof v === "string" && v).map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{FIELD[k]}</dt><dd className="whitespace-pre-wrap break-words">{(v as string).slice(0, 2000)}</dd></div>
              ))}
            </dl>
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
