"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Mail, Paperclip, RefreshCw, Search, Undo2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MailDetail, MailItem, MailSearch } from "@/lib/gw/mail";
import { splitRecipients } from "@/lib/gw/mail";
import { GwTabs, NoAppNotice } from "@/components/gw/GwCommon";

type SearchState = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; data: MailSearch };
type ListState = { kind: "loading" } | { kind: "no_app"; message: string } | { kind: "error"; message: string } | { kind: "ready"; unread: number; items: MailItem[] };
type DetailState = { kind: "idle" } | { kind: "loading"; muid: string } | { kind: "error"; muid: string; message: string } | { kind: "ready"; mail: MailDetail };

const fmt = (s: string) => { const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(s.trim()); return m ? `${m[1]} ${m[2]}` : s; };
const who = (m: MailItem) => m.from || m.fromEmail || "(보낸 사람 없음)";
const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);

/** 아마란스 받은메일 — 서버가 데스크톱 앱에 중계(list_mail_inbox·read_mail·mark_mail_unread). 앱이 꺼져 있으면 안내만 보인다. */
export default function MailPage() {
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [detail, setDetail] = useState<DetailState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"date" | "relevance">("date");
  const [search, setSearch] = useState<SearchState>({ kind: "idle" });

  // 검색 — 데스크톱 앱의 기기 안 색인(search_mail_index). 300ms 멈춤 뒤 호출, 늦게 온 이전 응답은 버린다.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setSearch({ kind: "idle" }); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setSearch({ kind: "loading" });
      try {
        const res = await fetch(`/api/gw/mail/search?q=${encodeURIComponent(query)}&sort=${sort}`, { cache: "no-store" });
        const data = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setSearch({ kind: "ready", data });
      } catch (e) { if (alive) setSearch({ kind: "error", message: e instanceof Error ? e.message : "검색하지 못했습니다." }); }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [q, sort]);

  const load = useCallback(async () => {
    setList({ kind: "loading" });
    try {
      const res = await fetch("/api/gw/mail", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 409 && data.code === "no_app") { setList({ kind: "no_app", message: data.error }); return; }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setList({ kind: "ready", unread: Number(data.unread) || 0, items: Array.isArray(data.items) ? data.items : [] });
    } catch (e) { setList({ kind: "error", message: e instanceof Error ? e.message : "메일을 불러오지 못했습니다." }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const open = async (m: MailItem) => {
    setDetail({ kind: "loading", muid: m.muid });
    try {
      const res = await fetch(`/api/gw/mail/${m.muid}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDetail({ kind: "ready", mail: data });
      // 열면 아마란스가 읽음 처리하므로 목록도 맞춘다
      setList((old) => old.kind === "ready" ? { ...old, unread: m.seen ? old.unread : Math.max(0, old.unread - 1), items: old.items.map((x) => (x.muid === m.muid ? { ...x, seen: true } : x)) } : old);
    } catch (e) { setDetail({ kind: "error", muid: m.muid, message: e instanceof Error ? e.message : "본문을 불러오지 못했습니다." }); }
  };

  const markUnread = async (muid: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/gw/mail/${muid}/unread`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setList((old) => old.kind === "ready" ? { ...old, unread: old.unread + 1, items: old.items.map((x) => (x.muid === muid ? { ...x, seen: false } : x)) } : old);
      setDetail({ kind: "idle" });
    } catch (e) { setDetail({ kind: "error", muid, message: e instanceof Error ? e.message : "안 읽음으로 되돌리지 못했습니다." }); }
    finally { setBusy(false); }
  };

  const showDetail = detail.kind !== "idle";
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <GwTabs />
      <div className="flex flex-wrap items-center gap-2">
        <Mail className="h-5 w-5 text-rose-600" aria-hidden="true" />
        <h1 className="text-lg font-semibold">메일</h1>
        {list.kind === "ready" && <Badge variant="secondary">안 읽음 {list.unread}</Badge>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} disabled={list.kind === "loading"}><RefreshCw className={`mr-1 h-4 w-4 ${list.kind === "loading" ? "animate-spin" : ""}`} />새로고침</Button>
      </div>
      <p className="text-sm text-muted-foreground">아마란스 받은메일 최근 20통입니다. 같은 계정으로 로그인한 데스크톱 앱이 대신 조회하므로 앱이 켜져 있어야 합니다. 메일을 열면 아마란스에서도 읽음으로 바뀝니다.</p>
      {list.kind === "ready" && <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="메일 검색" placeholder="검색 · from:이름 subject:제목 after:2026-09 has:attach is:unread in:sent" title={'단어는 AND · "구문" · -제외 · OR · from: to: subject: body: file: after: before: has:attach is:unread in:sent'}
            className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm focus-visible:outline-2 focus-visible:outline-primary" />
        </div>
        <Button variant={sort === "date" ? "secondary" : "ghost"} size="sm" onClick={() => setSort("date")} aria-pressed={sort === "date"}>최신순</Button>
        <Button variant={sort === "relevance" ? "secondary" : "ghost"} size="sm" onClick={() => setSort("relevance")} aria-pressed={sort === "relevance"}>관련도순</Button>
      </div>}

      {list.kind === "no_app" && <NoAppNotice message={list.message} onRetry={() => void load()} />}
      {list.kind === "error" && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{list.message}<Button variant="outline" size="sm" onClick={() => void load()}>다시 시도</Button></AlertDescription></Alert>}
      {list.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">데스크톱 앱에서 메일을 가져오고 있습니다…</p>}

      {list.kind === "ready" && <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <section aria-label={search.kind === "idle" ? "받은메일" : "검색 결과"} className={`rounded-xl border bg-card ${showDetail ? "hidden md:block" : ""}`}>
          {search.kind !== "idle" ? <SearchResults state={search} open={open} current={detail.kind === "ready" ? detail.mail.muid : "muid" in detail ? detail.muid : ""} /> : list.items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">받은 메일이 없습니다.</p> : <ul className="divide-y">
            {list.items.map((m) => <li key={m.muid}>
              <button type="button" onClick={() => void open(m)} aria-current={detail.kind !== "idle" && "muid" in detail ? detail.muid === m.muid || undefined : detail.kind === "ready" && detail.mail.muid === m.muid ? true : undefined}
                className={`block w-full px-4 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary ${detail.kind === "ready" && detail.mail.muid === m.muid ? "bg-primary/5" : ""}`}>
                <div className="flex items-baseline justify-between gap-3"><span className={`truncate text-sm ${m.seen ? "" : "font-bold"}`}>{who(m)}</span><time className="shrink-0 text-xs text-muted-foreground">{fmt(m.date)}</time></div>
                <div className={`mt-0.5 flex items-center gap-1 truncate text-sm ${m.seen ? "text-muted-foreground" : "font-semibold"}`}>{m.attach && <Paperclip className="h-3.5 w-3.5 shrink-0" aria-label="첨부 있음" />}<span className="truncate">{m.subject || "(제목 없음)"}</span></div>
              </button>
            </li>)}
          </ul>}
        </section>
        <section aria-label="본문" className={`rounded-xl border bg-card p-5 ${showDetail ? "" : "hidden md:block"}`}>
          {detail.kind === "idle" && <p className="text-sm text-muted-foreground">왼쪽 목록에서 메일을 고르세요.</p>}
          {detail.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">본문을 가져오고 있습니다…</p>}
          {detail.kind === "error" && <Alert variant="destructive"><AlertDescription>{detail.message}</AlertDescription></Alert>}
          {detail.kind === "ready" && <article>
            <Button variant="ghost" size="sm" className="mb-2 md:hidden" onClick={() => setDetail({ kind: "idle" })}><ArrowLeft className="mr-1 h-4 w-4" />목록</Button>
            <h2 className="text-base font-semibold break-words">{detail.mail.subject || "(제목 없음)"}</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <dt>보낸 사람</dt><dd className="break-words">{detail.mail.from}</dd>
              <dt>받는 사람</dt><Recipients value={detail.mail.to} />
              {detail.mail.cc && <><dt>참조</dt><Recipients value={detail.mail.cc} /></>}
              <dt>시각</dt><dd>{fmt(detail.mail.date)}</dd>
            </dl>
            {detail.mail.attachments.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="첨부 파일">
              {detail.mail.attachments.map((a, i) => <li key={`${a.fileName}-${i}`}><Badge variant="outline" className="gap-1 font-normal"><Paperclip className="h-3 w-3" />{a.fileName}{a.fileSizeApprox > 0 && <span className="text-muted-foreground">· {kb(a.fileSizeApprox)}</span>}</Badge></li>)}
            </ul>}
            <pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{detail.mail.body || "(본문 없음)"}</pre>
            <p className="mt-4 text-xs text-muted-foreground">서식 없는 텍스트로 보여 줍니다{detail.mail.remoteResourceCount > 0 ? ` · 외부 이미지 ${detail.mail.remoteResourceCount}개는 표시하지 않습니다` : ""}. 첨부 내려받기는 아마란스에서 하세요.</p>
            <div className="mt-3"><Button variant="outline" size="sm" disabled={busy} onClick={() => void markUnread(detail.mail.muid)}><Undo2 className="mr-1 h-4 w-4" />안 읽음으로 되돌리기</Button></div>
          </article>}
        </section>
      </div>}
    </div>
  );
}

/** 색인 검색 결과 — 받은·보낸 메일, 본문 발췌. 색인 상태 줄(통 수·동기화 중)을 함께 보여 준다. */
function SearchResults({ state, open, current }: { state: SearchState; open: (m: MailItem) => void; current: string }) {
  if (state.kind === "loading") return <p role="status" className="p-6 text-center text-sm text-muted-foreground">데스크톱 앱 색인에서 찾고 있습니다…</p>;
  if (state.kind === "error") return <Alert variant="destructive" className="m-4"><AlertDescription>{state.message}</AlertDescription></Alert>;
  if (state.kind !== "ready") return null;
  const { hits, total, index } = state.data;
  const status = `색인 ${index.docs}통 · 본문 ${index.bodies}통${index.syncing ? " · 동기화 중 — 잠시 뒤 다시 검색하면 더 찾습니다" : index.error ? ` · 동기화 실패: ${index.error}` : ""}`;
  return <div>
    <p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">{total}통 · {status}</p>
    {hits.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">결과 없음{index.bodies < index.docs ? " · 본문은 이미 읽은 메일만 색인됩니다" : ""}</p> : <ul className="divide-y">
      {hits.map((h) => <li key={`${h.box}-${h.muid}`}>
        <button type="button" onClick={() => open(h)} aria-current={current === h.muid || undefined} className={`block w-full px-4 py-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary ${current === h.muid ? "bg-primary/5" : ""}`}>
          <div className="flex items-baseline justify-between gap-3"><span className={`truncate text-sm ${h.seen ? "" : "font-bold"}`}>{h.box === "SENT" ? `보낸 메일${h.to ? ` · ${h.to}` : ""}` : who(h)}</span><time className="shrink-0 text-xs text-muted-foreground">{fmt(h.date)}</time></div>
          <div className={`mt-0.5 flex items-center gap-1 truncate text-sm ${h.seen ? "" : "font-semibold"}`}>{h.attach && <Paperclip className="h-3.5 w-3.5 shrink-0" aria-label="첨부 있음" />}<span className="truncate">{h.subject || "(제목 없음)"}</span></div>
          {h.snippet && <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{h.snippet}</p>}
        </button>
      </li>)}
    </ul>}
  </div>;
}

/** 받는 사람·참조 — 2명까지만 보이고 나머지는 "외 N명 더보기"로 펼친다. */
function Recipients({ value }: { value: string }) {
  const [open, setOpen] = useState(false);
  const all = splitRecipients(value);
  const shown = open ? all : all.slice(0, 2);
  const more = all.length - 2;
  return <dd className="break-words">
    {shown.length === 0 ? value : shown.map((r, i) => <span key={i} className="block">{r}</span>)}
    {more > 0 && <button type="button" className="mt-0.5 text-xs font-medium text-primary hover:underline" onClick={() => setOpen((o) => !o)}>{open ? "접기" : `외 ${more}명 더보기`}</button>}
  </dd>;
}
