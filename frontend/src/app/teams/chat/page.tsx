"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, Loader2, MessageCircle, Paperclip, RefreshCw, Search, SendHorizontal, User as UserIcon, Users, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEnterToSend } from "@/hooks/useEnterToSend";
import { useMsCallbackQuery } from "@/hooks/useMsCallbackQuery";
import { initialChatId } from "@/lib/home";
import { byNewest } from "@/lib/teams/sort";
import { cn } from "@/lib/utils";

/**
 * 내가 속한 Teams 채팅(그룹·1:1)을 우리 화면에서 읽고 보낸다(Graph 위임 — 본인 이름으로 전송).
 * 왼쪽 목록에서 채팅을 고르면 오른쪽에 대화. 5초 폴링(since = 마지막 수정 시각, 탭이 보일 때만). 앱 WebView에서는 목록 → 대화 두 화면.
 * 목록은 마지막 메시지 순(서버) — 열어 둔 채팅에 새 메시지가 오거나 보내면 그 채팅을 맨 위로 올린다. 첨부 파일은 링크(본인 Microsoft 권한으로 열림).
 */
interface ChatSummary { id: string; type: "group" | "oneOnOne"; topic: string; members: string[]; webUrl: string | null; lastUpdated: string | null }
interface Info { connected: boolean; hasChatScope: boolean; meId?: string; chats?: ChatSummary[] }
interface Hit { id: string; chatId: string; createdAt: string; from: string; snippet: string }
interface Msg { id: string; createdAt: string; modifiedAt: string; from: { id: string; name: string } | null; text: string; attachments: Array<{ id: string; name: string; url: string | null }> }

const POLL_MS = 5000;
const LAST_KEY = "teams-chat:last";
const connectHref = `/api/ms/connect?returnTo=${encodeURIComponent("/teams/chat")}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
/** 응답 본문 → JSON. 504(시간 초과)·HTML 500처럼 JSON이 아니면 빈 객체 — 상태 코드로 안내한다. */
const readJson = async (r: Response): Promise<Record<string, unknown>> => {
  try { return (await r.json()) as Record<string, unknown>; } catch { return {}; }
};
const fmtAgo = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso); const now = new Date();
  return d.toDateString() === now.toDateString() ? fmtTime(iso) : d.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
};

export default function TeamsChatPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 검색: 입력하면 채팅 이름·구성원으로 바로 거르고, Enter(돋보기)면 메시지 내용을 Microsoft 검색으로
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchReconnect, setSearchReconnect] = useState(false);
  const sinceRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const ready = Boolean(info?.connected && info.hasChatScope);
  const current = info?.chats?.find((c) => c.id === chatId) ?? null;

  const loadInfo = useCallback(async () => {
    setRefreshing(true);
    try {
      const r = await fetch("/api/teams/chat");
      const j = await readJson(r);
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : `준비 상태를 확인하지 못했습니다 (${r.status})`);
      if (typeof j.connected !== "boolean") throw new Error("준비 상태를 확인하지 못했습니다. 잠시 뒤 다시 시도하세요.");
      const next = j as unknown as Info;
      setInfo(next);
      setInfoError(null);
      const chats = next.chats ?? [];
      let last: string | null = null;
      try { last = localStorage.getItem(LAST_KEY); } catch { /* 저장소 없음 */ }
      const requested = new URLSearchParams(window.location.search).get("chat");
      const initial = initialChatId(chats.map((c) => c.id), requested, last);
      if (initial) setChatId((cur) => cur ?? initial);
    } catch (e) {
      setInfoError(e instanceof Error ? e.message : "준비 상태를 확인하지 못했습니다.");
    } finally {
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { void loadInfo(); }, [loadInfo]);
  // Microsoft 연결에서 돌아온 결과(?ms_error=…)를 보여 준다 — 연결 성공은 위 loadInfo가 새 상태를 읽는다
  useMsCallbackQuery({ onError: setError });

  const select = (id: string | null) => {
    setChatId(id);
    setMessages([]);
    setLoaded(false);
    setError(null);
    sinceRef.current = null;
    if (id) { try { localStorage.setItem(LAST_KEY, id); } catch { /* 저장소 없음 */ } }
  };

  const merge = useCallback((incoming: Msg[]) => {
    if (!incoming.length) return;
    setMessages((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      for (const m of incoming) map.set(m.id, m);
      return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
    for (const m of incoming) if (!sinceRef.current || m.modifiedAt > sinceRef.current) sinceRef.current = m.modifiedAt;
    const newest = incoming.reduce((t, m) => (m.createdAt > t ? m.createdAt : t), "");
    setInfo((i) => {
      const cur = i?.chats?.find((c) => c.id === chatId);
      if (!i?.chats || !cur || (cur.lastUpdated ?? "") >= newest) return i;
      const chats = i.chats.map((c) => (c.id === chatId ? { ...c, lastUpdated: newest } : c)).sort(byNewest);
      return { ...i, chats };
    });
  }, [chatId]);

  const load = useCallback(async () => {
    if (!chatId) return;
    const q = new URLSearchParams({ chat: chatId });
    if (sinceRef.current) q.set("since", sinceRef.current);
    let r: Response;
    try { r = await fetch(`/api/teams/chat/messages?${q.toString()}`); }
    catch { setError("네트워크 연결을 확인해 주세요. 잠시 뒤 다시 불러옵니다."); return; }
    const j = await readJson(r);
    if (!r.ok) {
      setError(typeof j.error === "string" ? j.error : `메시지를 불러오지 못했습니다 (${r.status})`);
      if (j.code === "reconnect") setInfo((i) => (i ? { ...i, hasChatScope: false } : i));
      return;
    }
    setError(null);
    merge(Array.isArray(j.messages) ? (j.messages as Msg[]) : []);
    setLoaded(true);
  }, [chatId, merge]);

  useEffect(() => {
    if (!ready || !chatId) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [ready, chatId, load]);

  const count = messages.length;
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "end" }); }, [count, chatId]);

  const send = async (raw: string = text) => {
    const body = raw.trim();
    if (!body || sending || !chatId) return;
    setSending(true);
    try {
      const r = await fetch("/api/teams/chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat: chatId, text: body }) });
      const j = await readJson(r);
      if (!r.ok || !j.message) { setError(typeof j.error === "string" ? j.error : `보내지 못했습니다 (${r.status})`); return; }
      merge([j.message as Msg]);
      setText("");
      setError(null);
    } catch {
      setError("보내지 못했습니다. 네트워크 연결을 확인해 주세요.");
    } finally {
      setSending(false);
      inputRef.current?.focus(); // 보낸 뒤에도 입력창에 — 이어서 대화
    }
  };

  const searchMessages = async () => {
    const q = query.trim();
    if (q.length < 2 || searching) return;
    setSearching(true); setSearchError(null); setSearchReconnect(false);
    try {
      const r = await fetch(`/api/teams/chat/search?${new URLSearchParams({ q })}`);
      const j = await readJson(r);
      if (!r.ok || !Array.isArray(j.hits)) {
        setHits(null);
        setSearchError(typeof j.error === "string" ? j.error : `검색하지 못했습니다 (${r.status})`);
        setSearchReconnect(j.code === "reconnect_search" || j.code === "reconnect");
        return;
      }
      setHits(j.hits as Hit[]);
    } catch {
      setSearchError("검색하지 못했습니다. 네트워크 연결을 확인해 주세요.");
    } finally {
      setSearching(false);
    }
  };
  const clearSearch = () => { setQuery(""); setHits(null); setSearchError(null); setSearchReconnect(false); };

  const enterKeys = useEnterToSend((v) => { void send(v); });

  if (infoError && !info) return <Alert variant="destructive" className="mx-auto max-w-xl"><AlertDescription>{infoError}</AlertDescription></Alert>;
  if (!info) return <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />준비 상태를 확인하고 있습니다…</div>;
  if (!ready) {
    return (
      <Card className="mx-auto max-w-xl space-y-4 p-6">
        <div className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5 text-primary" />Teams 채팅</div>
        <p className="text-sm text-muted-foreground">
          {info.connected
            ? "연결된 Microsoft 계정에 Teams 채팅 권한(Chat.ReadWrite)이 없습니다. 다시 연결하면 권한이 추가됩니다(회사 설정에 따라 관리자 승인 화면이 나오면 IT 담당자에게 요청해 주세요)."
            : "내가 속한 Teams 채팅을 본인 Microsoft 계정으로 읽고 보냅니다. 먼저 Microsoft 계정을 연결하세요(회사 설정에 따라 관리자 승인 화면이 나오면 IT 담당자에게 요청해 주세요)."}
        </p>
        <Button asChild><a href={connectHref}>{info.connected ? "Microsoft 계정 다시 연결(권한 추가)" : "Microsoft 계정 연결"}</a></Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </Card>
    );
  }

  const allChats = info.chats ?? [];
  const needle = query.trim().toLowerCase();
  const chats = needle ? allChats.filter((c) => c.topic.toLowerCase().includes(needle) || c.members.some((n) => n.toLowerCase().includes(needle))) : allChats;
  // 목록은 최근 50개 채팅뿐 — 그 밖의 채팅에서 찾은 메시지는 열 수 없어 안내만
  const chatName = (id: string) => allChats.find((c) => c.id === id)?.topic ?? null;
  let lastDay = "";
  return (
    <div className="animate-fade-up">
    {/* PC 제목 줄(다른 페이지와 같은 형식) — 휴대폰은 화면 높이를 아끼려고 목록 카드 제목만 */}
    <div className="mb-4 hidden items-center gap-3 md:flex">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50"><MessageCircle className="h-5 w-5 text-indigo-600" /></div>
      <div><h1 className="text-2xl font-bold tracking-tight">Teams 채팅</h1><p className="text-sm text-muted-foreground">내가 속한 그룹·1:1 채팅 읽기·보내기</p></div>
    </div>
    {/* 앱 WebView(data-app)는 웹 상단 바가 없고 제목 줄은 앱 상단으로 옮겨지므로 main 위아래 여백(1rem+2rem)만 뺀다 */}
    <div className="flex h-[calc(100dvh-8.5rem)] min-h-[24rem] gap-3 md:h-[calc(100dvh-12.5rem)] [body[data-app]_&]:h-[calc(100dvh-3rem)]">
      <Card className={cn("flex w-full flex-col overflow-hidden md:w-80 md:shrink-0", chatId && "hidden md:flex")}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5 text-primary md:hidden" />내 채팅</h2>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void loadInfo()} disabled={refreshing} aria-label="목록 새로고침">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          </Button>
        </div>
        <form className="flex items-center gap-1 border-b px-3 py-2" role="search" onSubmit={(e) => { e.preventDefault(); void searchMessages(); }}>
          <Input value={query} onChange={(e) => { setQuery(e.target.value); setHits(null); setSearchError(null); }} placeholder="채팅 이름·사람 거르기, Enter로 메시지 검색" aria-label="채팅 검색" maxLength={100} className="h-8 text-sm" />
          {query && <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={clearSearch} aria-label="검색 지우기"><X className="h-4 w-4" /></Button>}
          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={searching || query.trim().length < 2} aria-label="메시지 내용 검색">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </form>
        <div className="flex-1 overflow-y-auto">
          {searchError && <p className="px-4 py-2 text-xs text-destructive">{searchError}{searchReconnect && <> <a href={connectHref} className="font-medium underline">다시 연결</a></>}</p>}
          {hits && (
            <div className="border-b">
              <p className="bg-muted/50 px-4 py-1.5 text-xs font-medium text-muted-foreground">메시지 검색 결과 {hits.length}건{hits.length >= 25 ? "(관련도 높은 25건)" : ""}</p>
              {!hits.length && <p className="px-4 py-3 text-sm text-muted-foreground">&lsquo;{query.trim()}&rsquo;가 들어간 메시지를 찾지 못했습니다.</p>}
              {hits.map((h) => (
                <button key={`${h.chatId}:${h.id}`} type="button" disabled={!chatName(h.chatId)} onClick={() => select(h.chatId)} className={cn("block w-full border-t px-4 py-2 text-left hover:bg-muted/60 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent", h.chatId === chatId && "bg-primary/5")}>
                  <span className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                    <span className="truncate"><span className="font-medium text-foreground">{h.from || "알 수 없음"}</span> · {chatName(h.chatId) ?? "최근 50개 밖의 채팅 — Teams에서 확인"}</span>
                    {h.createdAt && <span className="shrink-0 text-[11px]">{fmtAgo(h.createdAt)}</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 break-words text-sm">{h.snippet || "(요약 없음)"}</span>
                </button>
              ))}
            </div>
          )}
          {needle && !chats.length && <p className="p-4 text-sm text-muted-foreground">이름·구성원이 맞는 채팅이 없습니다. Enter를 누르면 메시지 내용에서 찾습니다.</p>}
          {!needle && !chats.length && <p className="p-4 text-sm text-muted-foreground">참여 중인 그룹·1:1 채팅이 없습니다. Teams에서 대화를 시작하면 여기에 나타납니다.</p>}
          {chats.map((c) => (
            <button key={c.id} type="button" onClick={() => select(c.id)} className={cn("flex w-full items-center gap-3 border-b px-4 py-3 text-left hover:bg-muted/60", c.id === chatId && "bg-primary/5")}>
              <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", c.type === "group" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                {c.type === "group" ? <Users className="h-5 w-5" /> : <UserIcon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium">{c.topic}</span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{fmtAgo(c.lastUpdated)}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">{c.type === "group" ? `${c.members.length}명 · ${c.members.join(", ")}` : "1:1"}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <Card className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-0 overflow-hidden py-0", !chatId && "hidden md:flex")}>
        {!current ? (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">왼쪽에서 채팅을 고르세요.</div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b px-3 py-2">
              <Button variant="ghost" size="icon" className="h-8 w-8 md:hidden" onClick={() => select(null)} aria-label="목록으로"><ArrowLeft className="h-4 w-4" /></Button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-sm font-semibold">{current.topic}</h2>
                <p className="truncate text-xs text-muted-foreground">{current.type === "group" ? `${current.members.length}명 · ${current.members.join(", ")}` : "1:1 채팅"}</p>
              </div>
              {current.webUrl && (
                <Button asChild variant="outline" size="sm"><a href={current.webUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Teams에서 열기</a></Button>
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-3 overflow-y-auto px-2 py-3 sm:px-3">
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
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-baseline gap-2 px-1 text-xs text-muted-foreground">
                        <span className="truncate font-medium">{m.from?.name ?? "알 수 없음"}</span>
                        <time dateTime={m.createdAt} className="shrink-0 text-[11px]">{fmtTime(m.createdAt)}</time>
                      </div>
                      <div className={cn("w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}>
                        {m.text || (m.attachments.length ? "" : "(내용 없음)")}
                        {m.attachments.length > 0 && (
                          <span className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            <Paperclip className="h-3 w-3 shrink-0" />
                            {m.attachments.map((a, i) => a.url
                              ? <a key={a.id || i} href={a.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{a.name}</a>
                              : <span key={a.id || i}>{a.name} — Teams에서 확인</span>)}
                          </span>
                        )}
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
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                {...enterKeys}
                placeholder="메시지 입력"
                rows={1}
                className="min-h-10 max-h-40 resize-none"
                aria-label="메시지"
              />
              <Button type="submit" size="icon" disabled={sending || !text.trim()} aria-label="보내기">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              </Button>
            </form>
          </>
        )}
      </Card>
    </div>
    </div>
  );
}
