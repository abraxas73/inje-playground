"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import ChatSidebar, { type ConvSummary } from "./ChatSidebar";
import Composer from "./Composer";
import ConfirmCard from "./ConfirmCard";
import MessageView from "./MessageView";
import StatusStrip, { type ChatStatus } from "./StatusStrip";
import { postTurn } from "@/lib/chat/sse-client";
import { DRAFT_KEY, SUGGESTIONS, applyEvent, emptyView, kstNow, startContinuation, startRetry, startUserTurn, stopView, toViewMessages, type ChatView } from "@/lib/chat/view";

/** 웹 채팅 워크스페이스(설계서 §3). 새 대화의 주소는 첫 conversation 이벤트에서 history.replaceState로 바꾼다(페이지를 다시 그리지 않아 스트림이 끊기지 않게). */
export default function ChatWorkspace({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const [view, setView] = useState<ChatView>(() => emptyView(conversationId ?? null));
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [config, setConfig] = useState<{ enabled: boolean; models: string[]; defaultModel: string } | null>(null);
  const [model, setModel] = useState("claude-sonnet-5-5");
  const [ephemeral, setEphemeral] = useState(false);
  const [status, setStatus] = useState<ChatStatus>(null);
  const [drawer, setDrawer] = useState(false);
  const convRef = useRef<string | null>(conversationId ?? null);
  const desktopRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadList = useCallback(async () => {
    const r = await fetch("/api/chat/conversations").catch(() => null);
    if (r?.ok) setConvs((await r.json()).conversations);
  }, []);

  const run = useCallback(async (body: Record<string, unknown>, prep: (v: ChatView) => ChatView) => {
    const ac = new AbortController();
    abortRef.current = ac;
    setView(prep);
    try {
      await postTurn({ ...body, conversationId: convRef.current ?? undefined, model, client: "web", ephemeral, desktopOnline: desktopRef.current, now: kstNow() }, (e) => {
        if (e.type === "conversation" && convRef.current !== e.id) { convRef.current = e.id; window.history.replaceState(null, "", `/chat/${e.id}`); }
        setView((v) => applyEvent(v, e));
      }, ac.signal);
    } catch (err) {
      setView((v) => (ac.signal.aborted ? stopView(v) : applyEvent(v, { type: "error", message: err instanceof Error ? err.message : "요청이 실패했습니다.", retryable: false })));
    } finally {
      abortRef.current = null;
      setView((v) => ({ ...v, busy: false }));
      void loadList();
    }
  }, [model, ephemeral, loadList]);

  const send = useCallback((text: string, attachments: Array<{ id: string; name: string }>) => {
    void run({ ...(text ? { text } : {}), ...(attachments.length ? { attachmentIds: attachments.map((a) => a.id) } : {}) }, (v) => startUserTurn(v, text, attachments));
  }, [run]);

  useEffect(() => {
    void loadList();
    fetch("/api/chat/config").then((r) => (r.ok ? r.json() : null)).then((c) => { if (c) { setConfig(c); setModel((m) => (c.models.includes(m) ? m : c.defaultModel)); } }).catch(() => {});
    fetch("/api/chat/status").then((r) => (r.ok ? r.json() : null)).then((s) => { if (s) { setStatus(s); desktopRef.current = s.desktop; } }).catch(() => {});
  }, [loadList]);

  useEffect(() => {
    if (!conversationId) {
      // 홈 입력창에서 넘어온 첫 질문
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(DRAFT_KEY); sessionStorage.removeItem(DRAFT_KEY); } catch { /* 저장소 막힘 */ }
      if (raw) {
        try {
          const d = JSON.parse(raw) as { text: string; attachments: Array<{ id: string; name: string }>; model?: string };
          if (d.model) setModel(d.model);
          send(d.text, d.attachments ?? []);
        } catch { /* 깨진 초안은 버린다 */ }
      }
      return;
    }
    fetch(`/api/chat/conversations/${conversationId}`).then(async (r) => {
      if (!r.ok) { setView((v) => ({ ...v, error: { message: "대화를 찾지 못했습니다.", retryable: false } })); return; }
      const j = await r.json();
      setModel(j.conversation.model);
      setView({ ...emptyView(conversationId), messages: toViewMessages(j.messages, j.toolCalls) });
    }).catch(() => setView((v) => ({ ...v, error: { message: "대화를 불러오지 못했습니다.", retryable: false } })));
    // conversationId가 바뀔 때만(목록에서 다른 대화를 눌렀을 때) 다시 읽는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [view.messages]);

  const sidebar = (
    <ChatSidebar items={convs} activeId={view.conversationId} ephemeral={ephemeral} onEphemeral={setEphemeral} canToggleEphemeral={!view.conversationId}
      onNew={() => { abortRef.current?.abort(); convRef.current = null; setView(emptyView(null)); setDrawer(false); router.push("/chat"); }}
      onRename={async (id, title) => { if (!title) return; await fetch(`/api/chat/conversations/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) }); void loadList(); }}
      onDelete={async (id) => { await fetch(`/api/chat/conversations/${id}`, { method: "DELETE" }); if (id === view.conversationId) { convRef.current = null; setView(emptyView(null)); router.push("/chat"); } void loadList(); }} />
  );

  if (config && !config.enabled) return <p className="py-16 text-center text-sm text-muted-foreground">관리자가 이노봇을 꺼 두었습니다.</p>;
  const last = view.messages.at(-1);
  return (
    <div className="-mx-4 -mb-20 -mt-6 flex h-[calc(100dvh-7rem)] md:-mx-8 md:-mb-8 md:-mt-8 md:h-[calc(100dvh-4rem)]">
      <aside className="hidden w-64 shrink-0 border-r md:block">{sidebar}</aside>
      <Sheet open={drawer} onOpenChange={setDrawer}><SheetContent side="left" className="w-72 p-0"><SheetTitle className="sr-only">대화 목록</SheetTitle>{sidebar}</SheetContent></Sheet>
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 md:block">
          <Button variant="ghost" size="icon" className="md:hidden" aria-label="대화 목록 열기" onClick={() => setDrawer(true)}><Menu className="h-5 w-5" /></Button>
          <div className="flex-1"><StatusStrip status={status} /></div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!view.messages.length && !view.error && (
            <div className="mx-auto max-w-xl pt-16 text-center">
              <h1 className="mb-4 text-xl font-bold">무엇을 도와드릴까요?</h1>
              <div className="flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => send(s, [])}>{s}</Button>)}</div>
            </div>
          )}
          {view.messages.map((m) => <MessageView key={m.id} message={m} onRetry={m === last && view.error?.retryable ? () => void run({ retry: true }, startRetry) : undefined} />)}
          {view.pending && <ConfirmCard calls={view.pending} busy={view.busy} onAnswer={(approve) => void run({ actions: view.pending!.map((c) => ({ id: c.id, approve })) }, startContinuation)} />}
          {view.error && !view.error.retryable && <p role="alert" className="text-center text-sm text-destructive">{view.error.message}</p>}
          <div ref={endRef} />
        </div>
        <div className="border-t p-3">
          <Composer busy={view.busy} models={config?.models ?? [model]} model={model} onModel={setModel} onSend={send} onStop={() => abortRef.current?.abort()} />
        </div>
      </section>
    </div>
  );
}
