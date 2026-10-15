"use client";

import { useRef, useState } from "react";
import { Loader2, Paperclip, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Upload = { key: string; name: string; id?: string; error?: string; warning?: string };
const MAX_FILES = 5;
const MODEL_LABEL: Record<string, string> = { "claude-sonnet-5-5": "Sonnet 5.5", "claude-opus-5-5": "Opus 5.5" };

/** 입력창 — Enter 전송(한글 조합 중 제외), Shift+Enter 줄바꿈, 📎·끌어 놓기·붙여 넣기 첨부(바로 올림), 모델 선택, 중지. */
export default function Composer({ busy, models, model, onModel, onSend, onStop, placeholder = "무엇을 도와드릴까요?" }: {
  busy: boolean; models: string[]; model: string; onModel: (m: string) => void; onSend: (text: string, attachments: Array<{ id: string; name: string }>) => void; onStop?: () => void; placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploading = uploads.some((u) => !u.id && !u.error);
  const ready = uploads.filter((u) => u.id) as Array<Upload & { id: string }>;

  async function add(files: File[]) {
    const room = MAX_FILES - uploads.length;
    for (const f of files.slice(0, Math.max(0, room))) {
      const key = `${f.name}-${Math.random()}`;
      setUploads((u) => [...u, { key, name: f.name }]);
      const fd = new FormData();
      fd.append("file", f);
      const res = await fetch("/api/chat/attachments", { method: "POST", body: fd }).catch(() => null);
      const j = res ? await res.json().catch(() => ({})) : {};
      setUploads((u) => u.map((x) => (x.key === key ? (res?.ok ? { ...x, id: j.id, warning: j.warning } : { ...x, error: j.error ?? "올리지 못했습니다." }) : x)));
    }
  }
  function send() {
    const t = text.trim();
    if (busy || uploading || (!t && !ready.length)) return;
    onSend(t, ready.map((u) => ({ id: u.id, name: u.name })));
    setText(""); setUploads([]);
  }
  return (
    <div className="rounded-2xl border bg-background p-2 shadow-sm" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add([...e.dataTransfer.files]); }}>
      {uploads.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5 px-1">
          {uploads.map((u) => (
            <li key={u.key} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs ${u.error ? "border-destructive text-destructive" : ""}`} title={u.error ?? u.warning}>
              {!u.id && !u.error ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}{u.name}{u.error ? ` — ${u.error}` : ""}
              <button type="button" aria-label={`${u.name} 빼기`} onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}><X className="h-3 w-3" /></button>
            </li>
          ))}
        </ul>
      )}
      {uploads.some((u) => u.warning) && <p className="mb-1 px-1 text-xs text-amber-600">이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.</p>}
      <Textarea aria-label="메시지" value={text} placeholder={placeholder} rows={2} className="min-h-[3rem] resize-none border-0 shadow-none focus-visible:ring-0"
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => { const files = [...e.clipboardData.files]; if (files.length) { e.preventDefault(); void add(files); } }}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />
      <div className="flex items-center gap-2 px-1">
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => { void add([...(e.target.files ?? [])]); e.target.value = ""; }} />
        <Button type="button" size="icon" variant="ghost" aria-label="파일 첨부" disabled={uploads.length >= MAX_FILES} onClick={() => fileRef.current?.click()}><Paperclip className="h-4 w-4" /></Button>
        {models.length > 1 && (
          <select aria-label="모델" className="rounded-md border bg-background px-2 py-1 text-xs" value={model} onChange={(e) => onModel(e.target.value)}>
            {models.map((m) => <option key={m} value={m}>{MODEL_LABEL[m] ?? m}</option>)}
          </select>
        )}
        <div className="flex-1" />
        {busy && onStop ? <Button type="button" size="sm" variant="outline" onClick={onStop}><Square className="mr-1 h-3.5 w-3.5" />중지</Button>
          : <Button type="button" size="sm" onClick={send} disabled={uploading || (!text.trim() && !ready.length)}><Send className="mr-1 h-3.5 w-3.5" />보내기</Button>}
      </div>
    </div>
  );
}
