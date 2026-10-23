"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GwTabs, NoAppNotice } from "@/components/gw/GwCommon";
import type { GwEvent } from "@/lib/gw/agenda";
import { kstDay } from "@/lib/chat/usage";

type State = { kind: "loading" } | { kind: "no_app"; message: string } | { kind: "error"; message: string } | { kind: "ready"; events: GwEvent[] };

const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const hm = (iso: string) => /T(\d{2}:\d{2})/.exec(iso)?.[1] ?? "";
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

/** 아마란스 일정(읽기 전용) — 서버가 데스크톱 앱에 중계(list_events). 오늘 기준 ±7일. */
export default function TodayPage() {
  const today = useMemo(() => kstDay(new Date()), []);
  const [date, setDate] = useState(today);
  const [all, setAll] = useState(false);
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/gw/schedule?date=${date}`, { cache: "no-store" });
      const data = await res.json();
      if (res.status === 409 && data.code === "no_app") { setState({ kind: "no_app", message: data.error }); return; }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({ kind: "ready", events: Array.isArray(data.events) ? data.events : [] });
    } catch (e) { setState({ kind: "error", message: e instanceof Error ? e.message : "일정을 불러오지 못했습니다." }); }
  }, [date]);
  useEffect(() => { void load(); }, [load]);

  const min = shift(today, -7), max = shift(today, 7);
  const shown = state.kind === "ready" ? state.events.filter((e) => all || e.mine) : [];
  const day = (e: GwEvent) => e.start.slice(0, 10);
  const when = (e: GwEvent) => e.allday ? "종일" : `${day(e) === date ? hm(e.start) : e.start.slice(5, 10).replace("-", "/") + " " + hm(e.start)} – ${e.end.slice(0, 10) === date ? hm(e.end) : e.end.slice(5, 10).replace("-", "/") + " " + hm(e.end)}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <GwTabs />
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h1 className="text-lg font-semibold">일정</h1>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="전날" disabled={date <= min} onClick={() => setDate(shift(date, -1))}><ChevronLeft className="h-4 w-4" /></Button>
          <input type="date" aria-label="날짜" value={date} min={min} max={max} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 rounded-md border bg-background px-2 text-sm" />
          <span className="text-sm text-muted-foreground">({WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()]})</span>
          <Button variant="ghost" size="icon" aria-label="다음 날" disabled={date >= max} onClick={() => setDate(shift(date, 1))}><ChevronRight className="h-4 w-4" /></Button>
          {date !== today && <Button variant="outline" size="sm" onClick={() => setDate(today)}>오늘</Button>}
        </div>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} disabled={state.kind === "loading"}><RefreshCw className={`mr-1 h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />새로고침</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <p>아마란스 일정입니다(오늘 기준 앞뒤 7일). 같은 계정으로 로그인한 데스크톱 앱이 대신 조회하므로 앱이 켜져 있어야 합니다.</p>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />공용 캘린더 일정도 보기</label>
      </div>
      {state.kind === "no_app" && <NoAppNotice message={state.message} onRetry={() => void load()} />}
      {state.kind === "error" && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{state.message}<Button variant="outline" size="sm" onClick={() => void load()}>다시 시도</Button></AlertDescription></Alert>}
      {state.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">데스크톱 앱에서 일정을 가져오고 있습니다…</p>}
      {state.kind === "ready" && (shown.length === 0 ? <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{all ? "일정이 없습니다." : "내 일정이 없습니다."}</p> : <ul className="divide-y rounded-xl border bg-card">
        {shown.map((e) => <li key={e.schSeq || `${e.start}-${e.title}`} className="flex gap-4 px-4 py-3">
          <span className="w-28 shrink-0 text-sm tabular-nums text-muted-foreground">{when(e)}</span>
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">{e.title || "(제목 없음)"}</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{[e.calendar, e.attendees && `참석 ${e.attendees}`].filter(Boolean).join(" · ")}{!e.mine && <Badge variant="outline" className="ml-2 font-normal">공용</Badge>}</p>
          </div>
        </li>)}
      </ul>)}
    </div>
  );
}
