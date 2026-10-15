"use client";

import Link from "next/link";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { groupByDate } from "@/lib/chat/view";

export type ConvSummary = { id: string; title: string; model: string; last_message_at: string };

/** 대화 목록 — 새 대화·저장 안 함, 날짜 묶음, 이름 바꾸기, 삭제(두 번 눌러 확인). */
export default function ChatSidebar({ items, activeId, ephemeral, onEphemeral, canToggleEphemeral, onNew, onRename, onDelete }: {
  items: ConvSummary[]; activeId: string | null; ephemeral: boolean; onEphemeral: (v: boolean) => void; canToggleEphemeral: boolean;
  onNew: () => void; onRename: (id: string, title: string) => void; onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <Button onClick={onNew} className="w-full justify-start"><Plus className="mr-2 h-4 w-4" />새 대화</Button>
      <div className="flex items-center gap-2 px-1">
        <Checkbox id="ephemeral" checked={ephemeral} disabled={!canToggleEphemeral} onCheckedChange={(v) => onEphemeral(v === true)} />
        <Label htmlFor="ephemeral" className="text-xs text-muted-foreground">저장 안 함(24시간 뒤 삭제)</Label>
      </div>
      <nav aria-label="대화 목록" className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {groupByDate(items, new Date()).map((g) => (
          <div key={g.label}>
            <p className="px-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
            <ul className="space-y-0.5">
              {g.items.map((c) => (
                <li key={c.id} className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${c.id === activeId ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
                  {editing === c.id ? (
                    <input autoFocus aria-label="대화 이름" defaultValue={c.title} maxLength={80} className="min-w-0 flex-1 rounded border bg-background px-1"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { onRename(c.id, e.currentTarget.value.trim()); setEditing(null); } if (e.key === "Escape") setEditing(null); }}
                      onBlur={() => setEditing(null)} />
                  ) : <Link href={`/chat/${c.id}`} className="min-w-0 flex-1 truncate">{c.title || "새 대화"}</Link>}
                  <button type="button" aria-label="이름 바꾸기" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setEditing(c.id)}><Pencil className="h-3.5 w-3.5" /></button>
                  {confirming === c.id
                    ? <button type="button" className="text-xs text-destructive" onClick={() => { onDelete(c.id); setConfirming(null); }} onBlur={() => setConfirming(null)}>삭제 확인</button>
                    : <button type="button" aria-label="삭제" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => setConfirming(c.id)}><Trash2 className="h-3.5 w-3.5" /></button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!items.length && <p className="px-2 text-xs text-muted-foreground">저장된 대화가 없습니다.</p>}
      </nav>
    </div>
  );
}
