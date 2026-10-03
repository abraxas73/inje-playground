"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, MessageCircle, Paperclip, SendHorizontal } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

/**
 * 지정된 Teams 그룹 채팅 1개를 우리 화면에서 읽고 보낸다(Graph 위임 — 본인 이름으로 전송).
 * 5초 폴링(since = 마지막 수정 시각, 탭이 보일 때만). 앱 WebView에서도 그대로 쓴다.
 */
interface Info { configured: boolean; topic?: string | null; connected?: boolean; hasChatScope?: boolean; webUrl?: string | null; meId?: string }
interface Msg { id: string; createdAt: string; modifiedAt: string; from: { id: string; name: string } | null; text: string; attachments: number }

const POLL_MS = 5000;
const connectHref = `/api/ms/connect?returnTo=${encodeURIComponent("/teams/chat")}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });

export default function TeamsChatPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const sinceRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const ready = Boolean(info?.configured && info.connected && info.hasChatScope);

  useEffect(() => {
    fetch("/api/teams/chat")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `준비 상태를 확인하지 못했습니다 (${r.status})`); setInfo(j); })
      .catch((e: Error) => setInfoError(e.message));
  }, []);

  const merge = useCallback((incoming: Msg[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    for (const m of incoming) if (!sinceRef.current || m.modifiedAt > sinceRef.current) sinceRef.current = m.modifiedAt;
  }, []);

  const load = useCallback(async () => {
    const q = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
    const r = await fetch(`/api/teams/chat/messages${q}`);
    const j = await r.json();
    if (!r.ok) {
      setError(j.error ?? `메시지를 불러오지 못했습니다 (${r.status})`);
      if (j.code === "reconnect") setInfo((i) => (i ? { ...i, hasChatScope: false } : i));
      return;
    }
    setError(null);
    merge(j.messages as Msg[]);
    setLoaded(true);
  }, [merge]);

  useEffect(() => {
    if (!ready) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [ready, load]);

  const count = messages.length;
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [count]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/teams/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: body }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? `보내지 못했습니다 (${r.status})`); return; }
      merge([j.message as Msg]);
      setText("");
      setError(null);
    } finally {
      setSending(false);
    }
  };

  if (infoError) return <Alert variant="destructive" className="mx-auto max-w-xl"><AlertDescription>{infoError}</AlertDescription></Alert>;
  if (!info) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />준비 상태를 확인하고 있습니다…</div>;
  if (!info.configured) {
    return <Card className="mx-auto max-w-xl p-6 text-sm text-muted-foreground">관리자가 아직 Teams 그룹 채팅을 지정하지 않았습니다. 시스템 설정 → Teams에서 &quot;내 그룹 채팅에서 고르기&quot;로 지정하면 여기에 나타납니다.</Card>;
  }
  if (!ready) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <div className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5 text-primary" />{info.topic ?? "Teams 그룹 채팅"}</div>
        <p className="text-sm text-muted-foreground">
          {info.connected
            ? "연결된 Microsoft 계정에 Teams 채팅 권한(Chat.ReadWrite)이 없습니다. 다시 연결하면 권한이 추가됩니다(관리자 동의는 필요 없습니다)."
            : "이 채팅은 본인 Microsoft 계정으로 읽고 보냅니다. 먼저 Microsoft 계정을 연결하세요(관리자 동의는 필요 없습니다)."}
        </p>
        <Button asChild><a href={connectHref}>{info.connected ? "Microsoft 계정 다시 연결(권한 추가)" : "Microsoft 계정 연결"}</a></Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    );
  }

  let lastDay = "";
  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] min-h-[24rem] max-w-3xl flex-col">
      <div className="flex items-center justify-between gap-2 pb-3">
        <div className="flex min-w-0 items-center gap-2">
          <MessageCircle className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-lg font-semibold">{info.topic ?? "Teams 그룹 채팅"}</h1>
        </div>
        {info.webUrl && (
          <Button asChild variant="outline" size="sm"><a href={info.webUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Teams에서 열기</a></Button>
        )}
      </div>
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {!loaded && !error && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />메시지를 불러오고 있습니다…</div>}
          {loaded && !messages.length && <p className="text-center text-sm text-muted-foreground">아직 메시지가 없습니다. 첫 인사를 남겨 보세요.</p>}
          {messages.map((m) => {
            const day = fmtDay(m.createdAt);
            const showDay = day !== lastDay;
            lastDay = day;
            const mine = !!m.from && m.from.id === info.meId;
            return (
              <div key={m.id}>
                {showDay && <div className="my-2 text-center text-xs text-muted-foreground">{day}</div>}
                <div className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                  {!mine && <span className="px-1 text-xs font-medium text-muted-foreground">{m.from?.name ?? "알 수 없음"}</span>}
                  <div className={cn("flex max-w-[85%] items-end gap-2", mine && "flex-row-reverse")}>
                    <div className={cn("whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}>
                      {m.text || (m.attachments ? "" : "(내용 없음)")}
                      {m.attachments > 0 && <span className={cn("mt-1 flex items-center gap-1 text-xs", mine ? "text-primary-foreground/80" : "text-muted-foreground")}><Paperclip className="h-3 w-3" />첨부 {m.attachments}개 — Teams에서 확인</span>}
                    </div>
                    <span className="shrink-0 pb-0.5 text-[11px] text-muted-foreground">{fmtTime(m.createdAt)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        {error && <p className="border-t px-4 py-2 text-xs text-destructive">{error}</p>}
        <form className="flex items-end gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}
            placeholder="메시지 입력 (Enter 전송, Shift+Enter 줄바꿈)"
            rows={1}
            className="min-h-10 max-h-40 resize-none"
            aria-label="메시지"
          />
          <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="보내기">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
          </Button>
        </form>
      </Card>
    </div>
  );
}
