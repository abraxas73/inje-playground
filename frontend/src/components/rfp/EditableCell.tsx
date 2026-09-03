"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onSave: (next: string) => Promise<void>;
  /** 접힌 상태에서 보일 줄 수(0이면 접지 않음) */
  clampLines?: number;
  placeholder?: string;
  className?: string;
}

/** 클릭 → textarea, blur 또는 ⌘/Ctrl+Enter 저장, Esc 취소. 실패하면 원래 값으로 되돌리고 오류를 표시. */
export default function EditableCell({ value, onSave, clampLines = 3, placeholder = "비어 있음", className }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);
  useEffect(() => { if (editing) { ref.current?.focus(); ref.current?.setSelectionRange(draft.length, draft.length); } }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = async () => {
    if (draft === value) { setEditing(false); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    const rows = Math.min(20, Math.max(2, draft.split("\n").length + 1));
    return (
      <div className={className}>
        <Textarea
          ref={ref}
          value={draft}
          rows={rows}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit(); }
          }}
          className="min-w-[12rem] text-sm"
        />
        <div className="mt-1 text-[11px] text-muted-foreground">{saving ? <span className="inline-flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />저장 중</span> : "⌘/Ctrl+Enter 저장 · Esc 취소"}</div>
      </div>
    );
  }

  const lines = value.split("\n").length;
  const clamp = clampLines > 0 && !expanded && lines > clampLines;
  return (
    <div className={cn("group cursor-text", className)} onClick={() => setEditing(true)} title="클릭해서 편집">
      <div className={cn("whitespace-pre-wrap break-words text-sm", clamp && "line-clamp-3", !value && "text-muted-foreground/60 italic")}>{value || placeholder}</div>
      {clampLines > 0 && lines > clampLines && (
        <button type="button" className="mt-0.5 text-[11px] text-primary hover:underline" onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}>
          {expanded ? "접기" : `더보기 (${lines}줄)`}
        </button>
      )}
      {error && <div className="mt-0.5 text-[11px] text-destructive">{error}</div>}
    </div>
  );
}
