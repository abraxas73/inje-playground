"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowRight, ExternalLink, Loader2, MessageCircle, Paperclip, RefreshCw, Search, SendHorizontal, SmilePlus, User as UserIcon, Users } from "lucide-react";
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
interface Reaction { type: string; emoji: string; image?: string; users: Array<{ id: string; name: string }> }
// 원문 서식(문단·굵게·목록·링크) — 서버가 이스케이프한 마크다운만 그린다(HTML 그대로 그리지 않음). 링크는 새 탭.
// 그림은 본문 그림 중계 주소(/api/teams/chat/image)만 그린다(누르면 새 탭에서 원본) — 그 밖의 주소는 불러오지 않는다
const MD: Components = {
  a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{children}</a>,
  img: ({ src, alt }) => typeof src === "string" && src.startsWith("/api/teams/chat/image?")
    ? (
      <a href={src} target="_blank" rel="noopener noreferrer" className="my-1 block w-fit no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element -- 본인 Teams 권한으로 중계하는 그림이라 next/image 최적화 대상이 아니다 */}
        <img src={src} alt={alt || "이미지"} loading="lazy" className="!my-0 max-h-72 max-w-full rounded-lg border border-black/10 bg-white object-contain" />
      </a>
    )
    : <span>[이미지{alt ? `: ${alt}` : ""}]</span>,
};
interface Msg { id: string; createdAt: string; modifiedAt: string; from: { id: string; name: string } | null; text: string; markdown?: string; attachments: Array<{ id: string; name: string; url: string | null }>; reactions?: Reaction[] }
const REACTIONS = ["👍", "❤️", "😆", "😮", "😢", "😡", "👀", "👏", "🙌", "🔥", "🎉", "🙏"]; // 서버 REACTION_CHOICES와 같다

/** 내 반응 하나를 붙이거나 뗀 결과(서버 응답 전에 먼저 보여 주고, 다음 폴링이 실제 상태로 맞춘다) */
function toggleReaction(list: Reaction[], type: string, emoji: string, me: string, on: boolean, image?: string): Reaction[] {
  const rest = list.map((r) => (r.type === type ? { ...r, users: r.users.filter((u) => u.id !== me) } : r));
  if (on) {
    const hit = rest.find((r) => r.type === type);
    if (hit) hit.users = [...hit.users, { id: me, name: "나" }];
    else rest.push({ type, emoji, ...(image ? { image } : {}), users: [{ id: me, name: "나" }] });
  }
  return rest.filter((r) => r.users.length > 0);
}

const POLL_MS = 5000;
const LAST_KEY = "teams-chat:last";
const connectHref = `/api/ms/connect?returnTo=${encodeURIComponent("/teams/chat")}`;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
/** 응답 본문 → JSON. 504(시간 초과)·HTML 500처럼 JSON이 아니면 빈 객체 — 상태 코드로 안내한다. */
const readJson = async (r: Response): Promise<Record<string, unknown>> => {
  try { return (await r.json()) as Record<string, unknown>; } catch { return {}; }
};
const fmtStamp = (iso: string) => new Date(iso).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
/** 검색 결과 묶음 제목·한 줄 — 앱 메신저 검색과 같은 모양(왼쪽 칸 방 제목 고정 폭, 오른쪽 칸 내용) */
function SearchHeader({ children }: { children: React.ReactNode }) {
  return <p className="px-4 pt-4 pb-1 text-xs font-bold text-muted-foreground">{children}</p>;
}
function SearchRow({ title, active, onClick, children }: { title: string; active?: boolean; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className={cn("flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted/60 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent", active && "bg-primary/5")}>
      <span className="line-clamp-2 w-28 shrink-0 break-words text-[13px] font-bold">{title}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}
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
  // 고르기 창 구분선 아래 사용자 정의 반응 — 서버 등록부(조직에서 본 것 전부) + 이 대화에 방금 보인 것(등록 전일 수 있다)
  const [registered, setRegistered] = useState<Reaction[]>([]);
  useEffect(() => {
    fetch("/api/teams/chat/custom-reactions").then((r) => (r.ok ? r.json() : null)).then((j: { reactions?: Reaction[] } | null) => setRegistered(j?.reactions ?? [])).catch(() => {});
  }, []);
  const customSeen = [...registered, ...messages.flatMap((m) => m.reactions ?? []).filter((r) => r.type.includes(";") && r.image?.startsWith("/api/teams/chat/image?"))].filter((r, i, all) => all.findIndex((x) => x.emoji === r.emoji) === i);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // 검색(앱 메신저 검색과 같은 구성): 돋보기로 검색 화면 → 대화방(이름·구성원) + 대화 내용(Microsoft 검색) 두 묶음
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [pickerFor, setPickerFor] = useState<string | null>(null); // 반응 고르기를 연 메시지
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
    setFocusId(null);
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
  useEffect(() => {
    const target = focusId ? document.querySelector(`[data-msg-id="${CSS.escape(focusId)}"]`) : null;
    if (target) target.scrollIntoView({ block: "center" });
    else if (!focusId) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [count, chatId, focusId]);

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

  const react = async (m: Msg, type: string, emoji: string, on: boolean, image?: string) => {
    const me = info?.meId;
    if (!chatId || !me) return;
    setPickerFor(null);
    const before = messages.find((x) => x.id === m.id)?.reactions ?? []; // 실패하면 요청 전 상태로(뒤집기 대신 — 그사이 바뀐 상태를 틀지 않게)
    const restore = () => setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: before } : x)));
    setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, reactions: toggleReaction(x.reactions ?? [], type, emoji, me, on, image) } : x)));
    try {
      const r = await fetch("/api/teams/chat/reaction", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat: chatId, message: m.id, reaction: type, on }) });
      if (!r.ok) { const j = await readJson(r); restore(); setError(typeof j.error === "string" ? j.error : `반응을 ${on ? "붙이지" : "떼지"} 못했습니다 (${r.status})`); }
    } catch {
      restore(); setError("반응을 보내지 못했습니다. 네트워크 연결을 확인해 주세요.");
    }
  };

  const runSearch = async () => {
    const q = query.trim();
    if (!q || searching) return;
    setSubmitted(q); setHits(null); setSearchError(null); setSearchReconnect(false);
    if (q.length < 2) return; // 대화 내용은 2자부터(대화방 이름은 1자도)
    setSearching(true);
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
  const closeSearch = () => { setSearchOpen(false); setQuery(""); setSubmitted(null); setHits(null); setSearchError(null); setSearchReconnect(false); };
  const openHit = (h: Hit) => { select(h.chatId); setFocusId(h.id); };

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

  const chats = info.chats ?? [];
  const needle = submitted?.toLowerCase() ?? "";
  const roomHits = needle ? chats.filter((c) => c.topic.toLowerCase().includes(needle) || c.members.some((n) => n.toLowerCase().includes(needle))) : [];
  const memberLine = (c: ChatSummary) => (c.type === "group" ? `${c.members.length}명 · ${c.members.join(", ")}` : "1:1");
  // 목록은 최근 50개 채팅뿐 — 그 밖의 채팅에서 찾은 메시지는 열 수 없어 안내만
  const chatName = (id: string) => chats.find((c) => c.id === id)?.topic ?? null;
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
      <Card className={cn("flex w-full flex-col overflow-hidden md:shrink-0", searchOpen ? "md:w-[26rem]" : "md:w-80", chatId && "hidden md:flex")}>
        {searchOpen ? (
          <>
            <div className="flex items-center gap-2 border-b px-2 py-2">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={closeSearch} aria-label="검색 닫기"><ArrowLeft className="h-4 w-4" /></Button>
              <h2 className="font-semibold">Teams 검색</h2>
            </div>
            <form className="px-3 py-3" role="search" onSubmit={(e) => { e.preventDefault(); void runSearch(); }}>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="대화방 이름 · 대화 내용" aria-label="검색어" maxLength={100} className="h-10 rounded-full pr-10 pl-9" />
                <Button type="submit" variant="ghost" size="icon" className="absolute top-1/2 right-1 h-8 w-8 -translate-y-1/2 rounded-full" disabled={searching || !query.trim()} aria-label="검색">
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                </Button>
              </div>
            </form>
            <div className="flex-1 overflow-y-auto pb-2">
              {submitted === null ? (
                <p className="p-6 text-center text-sm text-muted-foreground">검색어를 입력하세요</p>
              ) : (
                <>
                  {roomHits.length > 0 && <>
                    <SearchHeader>대화방 {roomHits.length}</SearchHeader>
                    {roomHits.map((c) => <SearchRow key={c.id} title={c.topic} active={c.id === chatId} onClick={() => select(c.id)}><span className="block truncate text-xs text-muted-foreground">{memberLine(c)}</span></SearchRow>)}
                  </>}
                  {searching && <p className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />대화 내용을 찾고 있습니다…</p>}
                  {searchError && <p className="px-4 py-2 text-xs text-destructive">{searchError}{searchReconnect && <> <a href={connectHref} className="font-medium underline">다시 연결</a></>}</p>}
                  {hits && hits.length > 0 && <>
                    <SearchHeader>대화 내용 {hits.length}{hits.length >= 25 ? " (관련도 높은 순)" : ""}</SearchHeader>
                    {hits.map((h) => (
                      <SearchRow key={`${h.chatId}:${h.id}`} title={chatName(h.chatId) ?? "최근 50개 밖의 대화"} active={h.chatId === chatId && h.id === focusId} onClick={chatName(h.chatId) ? () => openHit(h) : undefined}>
                        <span className="line-clamp-2 break-words text-[13px]">{h.snippet || "(요약 없음)"}</span>
                        <span className="block text-[11px] text-muted-foreground">{[h.from, h.createdAt && fmtStamp(h.createdAt)].filter(Boolean).join(" · ")}{chatName(h.chatId) ? "" : " · Teams에서 확인"}</span>
                      </SearchRow>
                    ))}
                  </>}
                  {!searching && !searchError && !roomHits.length && !hits?.length && (submitted.length < 2 || hits !== null) && (
                    <p className="p-6 text-center text-sm text-muted-foreground">결과가 없습니다{submitted.length < 2 ? " (대화 내용은 2자 이상으로 찾습니다)" : ""}</p>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 font-semibold"><MessageCircle className="h-5 w-5 text-primary md:hidden" />내 채팅</h2>
          <div className="flex items-center">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSearchOpen(true)} aria-label="검색"><Search className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void loadInfo()} disabled={refreshing} aria-label="목록 새로고침">
              <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            </Button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!chats.length && <p className="p-4 text-sm text-muted-foreground">참여 중인 그룹·1:1 채팅이 없습니다. Teams에서 대화를 시작하면 여기에 나타납니다.</p>}
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
                <span className="block truncate text-xs text-muted-foreground">{memberLine(c)}</span>
              </span>
            </button>
          ))}
        </div>
          </>
        )}
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
                  <div key={m.id} data-msg-id={m.id} className={cn(m.id === focusId && "rounded-2xl ring-2 ring-amber-400 ring-offset-2")}>
                    {showDay && <div className="my-2 text-center text-xs text-muted-foreground">{day}</div>}
                    <div className="group flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-baseline gap-2 px-1 text-xs text-muted-foreground">
                        <span className="truncate font-medium">{m.from?.name ?? "알 수 없음"}</span>
                        <time dateTime={m.createdAt} className="shrink-0 text-[11px]">{fmtTime(m.createdAt)}</time>
                        <button type="button" onClick={() => setPickerFor((p) => (p === m.id ? null : m.id))} className="ml-auto shrink-0 rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100 md:opacity-0 md:group-hover:opacity-100" aria-label="반응 붙이기" title="반응 붙이기">
                          <SmilePlus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {pickerFor === m.id && (
                        <div className="grid max-h-72 w-max grid-cols-6 self-start overflow-y-auto rounded-lg border bg-card p-0.5 shadow-sm" role="group" aria-label="반응 고르기">
                          {REACTIONS.map((e) => {
                            // 같은 그림이 옛 이름(like)·유니코드 두 묶음일 수 있다 — 떼기는 내가 붙인 묶음의 값으로, 붙이기는 있는 묶음(없으면 그림 그대로)
                            const same = (m.reactions ?? []).filter((r) => r.emoji === e && r.type !== "custom");
                            const minePick = same.find((r) => r.users.some((u) => u.id === info.meId));
                            const on = !!minePick;
                            return <button key={e} type="button" onClick={() => void react(m, (minePick ?? same[0])?.type ?? e, e, !on)} className={cn("flex h-7 w-7 items-center justify-center rounded text-base leading-none hover:bg-muted", on && "bg-primary/10")} aria-label={`${e} ${on ? "떼기" : "붙이기"}`}>{e}</button>;
                          })}
                          {customSeen.length > 0 && <div className="col-span-6 mx-1 my-0.5 border-t" role="separator" />}
                          {customSeen.map((c) => {
                            const on = (m.reactions ?? []).some((r) => r.type === c.type && r.users.some((u) => u.id === info.meId));
                            return (
                              <button key={c.type} type="button" onClick={() => void react(m, c.type, c.emoji, !on, c.image)} className={cn("flex h-7 w-7 items-center justify-center rounded hover:bg-muted", on && "bg-primary/10")} title={c.emoji} aria-label={`${c.emoji} ${on ? "떼기" : "붙이기"}`}>
                                {/* eslint-disable-next-line @next/next/no-img-element -- 본인 Teams 권한으로 중계하는 사용자 정의 반응 그림 */}
                                <img src={c.image} alt={c.emoji} className="h-5 w-5 object-contain" />
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className={cn("w-full break-words [overflow-wrap:anywhere] rounded-2xl px-3 py-2 text-sm", mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted")}>
                        {m.markdown
                          ? <div className={cn("prose prose-sm max-w-none text-inherit prose-p:my-0 prose-ol:my-1 prose-ul:my-1 prose-li:my-0 prose-code:before:content-none prose-code:after:content-none [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", mine ? "[--tw-prose-bold:currentColor] [--tw-prose-links:currentColor] [--tw-prose-code:currentColor] [--tw-prose-bullets:currentColor] [--tw-prose-counters:currentColor]" : "dark:prose-invert")}><ReactMarkdown remarkPlugins={[remarkGfm]} components={MD}>{m.markdown}</ReactMarkdown></div>
                          : <span className="whitespace-pre-wrap">{m.text || (m.attachments.length ? "" : "(내용 없음)")}</span>}
                        {m.attachments.length > 0 && (
                          <span className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs", mine ? "text-primary-foreground/80" : "text-muted-foreground")}>
                            <Paperclip className="h-3 w-3 shrink-0" />
                            {m.attachments.map((a, i) => a.url
                              ? <a key={a.id || i} href={a.url} target="_blank" rel="noopener noreferrer" className="break-all underline underline-offset-2">{a.name}</a>
                              : <span key={a.id || i}>{a.name} — Teams에서 확인</span>)}
                          </span>
                        )}
                      </div>
                      {(m.reactions?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1 px-1">
                          {m.reactions!.map((r) => {
                            const minePick = r.users.some((u) => u.id === info.meId);
                            const names = r.users.map((u) => (u.id === info.meId ? "나" : u.name)).filter(Boolean).join(", ");
                            return (
                              <button key={`${r.type}|${r.emoji}`} type="button" disabled={r.type === "custom"} onClick={() => void react(m, r.type, r.emoji, !minePick, r.image)} title={[r.emoji.startsWith(":") ? r.emoji : "", names].filter(Boolean).join(" · ") || undefined} aria-label={`${r.emoji} ${r.users.length}명${r.type === "custom" ? "" : minePick ? ", 내 반응 떼기" : ", 같이 붙이기"}`}
                                className={cn("flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent", minePick && "border-primary/50 bg-primary/10")}>
                                {r.image?.startsWith("/api/teams/chat/image?")
                                  // eslint-disable-next-line @next/next/no-img-element -- 본인 Teams 권한으로 중계하는 사용자 정의 반응 그림
                                  ? <img src={r.image} alt={r.emoji} loading="lazy" className="h-4 w-4 object-contain" />
                                  : <span className="text-sm leading-none">{r.emoji}</span>}
                                {r.users.length}
                              </button>
                            );
                          })}
                        </div>
                      )}
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
