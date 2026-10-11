"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Target = { kind: "channel" | "member"; id: string; name: string };
export default function DoorayMessenger({ channels }: { channels: { id: string; title: string }[] }) {
  const [mode, setMode] = useState<"channel" | "member">("channel");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(50);
  const [members, setMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [searched, setSearched] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const search = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  useEffect(() => () => search.current?.abort(), []);
  const matching = channels.filter(c => c.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function changeMode(next: typeof mode) {
    search.current?.abort(); setSearching(false); setMode(next); setQuery(""); setMembers([]); setSearched(false); setTarget(null); setError(""); setNotice(""); setLimit(50);
  }
  async function findMembers() {
    search.current?.abort(); const controller = new AbortController(); search.current = controller;
    setSearching(true); setError(""); setMembers([]); setSearched(false); setTarget(null);
    try {
      const res = await fetch(`/api/dooray/messenger?${new URLSearchParams({ q: query.trim() })}`, { cache: "no-store", signal: controller.signal });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "검색하지 못했습니다.");
      if (!controller.signal.aborted) { setMembers(data.items); setSearched(true); }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "검색하지 못했습니다."); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  async function send() {
    if (!target || !text.trim() || inFlight.current) return;
    inFlight.current = true; setSending(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/dooray/messenger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: target.kind, id: target.id, text: text.trim() }), signal: AbortSignal.timeout(15000) });
      const data = await res.json(); if (!res.ok) throw new Error(data.error || "전송 결과를 확인하지 못했습니다. Dooray에서 확인해 주세요.");
      setText(""); setNotice(`${target.name}에 메시지를 보냈습니다.`);
    } catch (e) { setError(e instanceof Error && e.name !== "TimeoutError" && e.name !== "TypeError" ? e.message : "전송 결과를 확인하지 못했습니다. 중복 전송을 피하려면 Dooray에서 확인한 뒤 다시 시도해 주세요."); }
    finally { inFlight.current = false; setSending(false); }
  }
  return <div className="space-y-3">
    <div className="flex gap-2"><Button variant={mode === "channel" ? "default" : "outline"} disabled={sending} onClick={() => changeMode("channel")}>대화방</Button><Button variant={mode === "member" ? "default" : "outline"} disabled={sending} onClick={() => changeMode("member")}>1:1 메시지</Button></div>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (mode === "member") void findMembers(); }}>
      <Input type="search" aria-label={mode === "channel" ? "대화방 검색" : "받는 사람 검색"} placeholder={mode === "channel" ? "대화방 이름 검색" : "이름 또는 Dooray 이메일"} value={query} disabled={sending} onChange={e => { search.current?.abort(); setSearching(false); setQuery(e.target.value); setTarget(null); setLimit(50); setMembers([]); setSearched(false); }} />
      {mode === "member" && <Button type="submit" variant="outline" disabled={sending || searching || query.trim().length < 2}>검색</Button>}
    </form>
    {searching && <p role="status">검색 중…</p>}
    {mode === "channel" ? <>
      <p className="text-sm text-muted-foreground">검색 결과 {matching.length}개 · {Math.min(limit, matching.length)}개 표시</p>
      <div className="max-h-72 overflow-y-auto">{matching.slice(0, limit).map(c => <button type="button" className="block w-full break-words border-b p-2 text-left hover:bg-muted disabled:opacity-50" key={c.id} disabled={sending} aria-pressed={target?.kind === "channel" && target.id === c.id} onClick={() => { setTarget({ kind: "channel", id: c.id, name: c.title }); setNotice(""); }}>{c.title}</button>)}</div>
      {matching.length > limit && <Button variant="outline" onClick={() => setLimit(n => n + 50)}>대화방 더 보기</Button>}
    </> : <>
      {searched && <p className="text-sm text-muted-foreground">{members.length ? "검색 결과 최대 20명입니다. 이름과 이메일을 확인해 선택하세요." : "검색된 사용자가 없습니다."}</p>}
      {members.map(m => <button type="button" key={m.id} className="block w-full break-words rounded border p-2 text-left hover:bg-muted" disabled={sending} aria-pressed={target?.kind === "member" && target.id === m.id} onClick={() => { setTarget({ kind: "member", id: m.id, name: `${m.name} (${m.email})` }); setNotice(""); }}><span className="font-medium">{m.name}</span> · {m.email}</button>)}
    </>}
    {target && <form className="space-y-2 rounded border p-3" onSubmit={e => { e.preventDefault(); void send(); }}>
      <p className="break-words text-sm">받는 {target.kind === "channel" ? "대화방" : "사람"}: <strong>{target.name}</strong></p>
      <Textarea aria-label="메시지" placeholder="메시지 입력" maxLength={4000} value={text} disabled={sending} onChange={e => setText(e.target.value)} />
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{text.length}/4,000자</span><Button type="submit" disabled={sending || !text.trim()}>{sending ? "전송 중…" : "보내기"}</Button></div>
    </form>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <p className="text-xs text-muted-foreground">연결한 본인 Dooray 계정으로 전송됩니다. 대화 이력은 Dooray에서 확인하세요.</p>
  </div>;
}
