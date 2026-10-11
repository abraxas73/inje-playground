"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import DoorayMessenger from "@/components/DoorayMessenger";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Overview = {
  connected: boolean; site: string; calendarSource?: "app";
  events: { calendars?: { id: string; name: string }[]; items: { id: string; calendarId: string; subject: string; startedAt: string; endedAt: string; wholeDayFlag: boolean }[]; error?: string };
  mail: { items: { id: string; subject: string; from: string; sentAt: string; preview?: string }[]; error?: string; partial?: boolean };
  channels: { items: { id: string; title: string }[]; error?: string };
};
function today() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()); }
function time(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }); }
export default function DoorayPage() {
  const [date, setDate] = useState(today);
  const [calendar, setCalendar] = useState("");
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(""); setData(null);
    try {
      const res = await fetch(`/api/dooray/overview?${new URLSearchParams({ date, ...(new URLSearchParams(window.location.search).get("calendarSource") === "app" ? { calendarSource: "app" } : {}), ...(calendar ? { calendar } : {}) })}`, { cache: "no-store", signal: controller.signal });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Dooray 정보를 불러오지 못했습니다.");
      if (!controller.signal.aborted) setData(result);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "조회에 실패했습니다."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }, [date, calendar]);
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => { clearTimeout(timer); request.current?.abort(); }; }, [load]);
  return <div className="space-y-5">
    <div className="flex items-center justify-between gap-3"><h1 className="text-2xl font-bold">내 Dooray</h1><Button variant="outline" size="icon" aria-label="Dooray 새로고침" disabled={busy} onClick={() => void load()}><RefreshCw className="h-4 w-4" /></Button></div>
    {data?.calendarSource !== "app" && <div className="flex flex-wrap items-center gap-2"><label htmlFor="dooray-date" className="text-sm">일정 날짜 (한국 시간)</label><Input id="dooray-date" type="date" className="w-auto" value={date} onChange={e => { if (e.target.value) { request.current?.abort(); setData(null); setDate(e.target.value); } }} /></div>}
    {busy && <p role="status">Dooray 정보를 불러오고 있습니다…</p>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {(error || data?.connected === false) && <Button asChild variant="outline"><Link href="/settings#dooray">Dooray 연결 설정</Link></Button>}
    {data?.connected && <>
      {data.calendarSource !== "app" && <Card><CardHeader><CardTitle>일정</CardTitle></CardHeader><CardContent className="space-y-3">
        {!!data.events.calendars?.length && <div className="flex flex-wrap items-center gap-2"><label htmlFor="dooray-calendar" className="text-sm">캘린더</label><select id="dooray-calendar" className="min-w-0 max-w-full rounded-md border bg-background px-3 py-2 text-sm" value={calendar} onChange={e => { request.current?.abort(); setData(null); setCalendar(e.target.value); }}><option value="">전체 캘린더</option>{data.events.calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {data.events.error && <p role="alert" className="text-sm text-destructive">{data.events.error}</p>}
        {!data.events.error && !data.events.items.length && <p className="text-sm text-muted-foreground">해당 날짜의 일정이 없습니다.</p>}
        {data.events.items.map(event => <div key={`${event.calendarId}:${event.id}`} className="border-b py-2 last:border-0"><p className="break-words font-medium">{event.subject || "제목 없음"}</p><p className="text-sm text-muted-foreground">{event.wholeDayFlag ? "종일" : `${time(event.startedAt)} – ${time(event.endedAt)}`}</p></div>)}
      </CardContent></Card>}
      <Card><CardHeader><CardTitle>최근 메일 소식</CardTitle><p className="text-sm text-muted-foreground">전체 메일함이나 미읽음 메일 목록이 아닙니다. 메일 피드에서 제공하는 최근 소식입니다.</p></CardHeader><CardContent className="space-y-3">
        {data.mail.error && <p role="alert" className="text-sm text-destructive">{data.mail.error}</p>}
        {data.mail.partial && <p className="text-sm text-muted-foreground">일부 메일 소식만 표시됩니다.</p>}
        {!data.mail.error && !data.mail.items.length && <p className="text-sm text-muted-foreground">최근 메일 소식이 없습니다.</p>}
        {data.mail.items.map(mail => <div key={mail.id} className="border-b py-2 last:border-0"><a className="block break-words font-medium text-primary underline underline-offset-4" href={`${data.site}/mail/systems/inbox/${encodeURIComponent(mail.id)}`} target="_blank" rel="noopener noreferrer">{mail.subject || "제목 없음"}</a><p className="break-words text-sm text-muted-foreground">{mail.from} · {time(mail.sentAt)}</p>{mail.preview && <details className="mt-2 text-sm"><summary className="cursor-pointer text-primary">본문 미리보기</summary><p className="mt-2 whitespace-pre-wrap break-words">{mail.preview}</p><p className="mt-2 text-muted-foreground">앞부분 최대 200자입니다. 전체 본문은 메일 제목을 눌러 Dooray에서 확인하세요.</p></details>}</div>)}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>대화방</CardTitle><p className="text-sm text-muted-foreground">대화방을 선택하거나 받는 사람을 검색해 메시지를 보낼 수 있습니다.</p></CardHeader><CardContent className="space-y-3">
        {data.channels.error && <p role="alert" className="text-sm text-destructive">{data.channels.error}</p>}
        <DoorayMessenger channels={data.channels.items} />
      </CardContent></Card>
      {/^https:\/\//.test(data.site) && <Button asChild variant="outline"><a href={data.site} target="_blank" rel="noopener noreferrer">Dooray에서 열기</a></Button>}
    </>}
  </div>;
}
