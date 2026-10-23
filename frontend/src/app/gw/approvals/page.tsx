"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, FileCheck2, Paperclip, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GwTabs, NoAppNotice } from "@/components/gw/GwCommon";
import type { Approval } from "@/lib/gw/agenda";

type State = { kind: "loading" } | { kind: "no_app"; message: string } | { kind: "error"; message: string } | { kind: "ready"; total: number; items: Approval[] };

/** 아마란스 미결 결재(읽기 전용) — 서버가 데스크톱 앱에 중계(pending_approvals). 처리는 아마란스 웹에서. */
export default function ApprovalsPage() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/gw/approvals", { cache: "no-store" });
      const data = await res.json();
      if (res.status === 409 && data.code === "no_app") { setState({ kind: "no_app", message: data.error }); return; }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setState({ kind: "ready", total: Number(data.total) || 0, items: Array.isArray(data.items) ? data.items : [] });
    } catch (e) { setState({ kind: "error", message: e instanceof Error ? e.message : "결재 목록을 불러오지 못했습니다." }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <GwTabs />
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2 className="h-5 w-5 text-indigo-600" aria-hidden="true" />
        <h1 className="text-lg font-semibold">미결 결재</h1>
        {state.kind === "ready" && <Badge variant="secondary">{state.total}건</Badge>}
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => void load()} disabled={state.kind === "loading"}><RefreshCw className={`mr-1 h-4 w-4 ${state.kind === "loading" ? "animate-spin" : ""}`} />새로고침</Button>
      </div>
      <p className="text-sm text-muted-foreground">아마란스 미결함 문서입니다(오래 기다린 순). 같은 계정으로 로그인한 데스크톱 앱이 대신 조회하므로 앱이 켜져 있어야 합니다. 결재 처리는 항목을 눌러 아마란스 웹에서 하세요.</p>
      {state.kind === "no_app" && <NoAppNotice message={state.message} onRetry={() => void load()} />}
      {state.kind === "error" && <Alert variant="destructive"><AlertDescription className="flex flex-wrap items-center gap-3">{state.message}<Button variant="outline" size="sm" onClick={() => void load()}>다시 시도</Button></AlertDescription></Alert>}
      {state.kind === "loading" && <p role="status" className="text-sm text-muted-foreground">데스크톱 앱에서 결재 목록을 가져오고 있습니다…</p>}
      {state.kind === "ready" && (state.items.length === 0 ? <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">기다리는 결재가 없습니다.</p> : <ul className="divide-y rounded-xl border bg-card">
        {state.items.map((a) => <li key={a.docId}>
          <a href={a.url} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
            <div className="flex items-baseline justify-between gap-3">
              <span className={`flex min-w-0 items-center gap-1 text-sm ${a.unread ? "font-bold" : ""}`}>{a.fileCount > 0 && <Paperclip className="h-3.5 w-3.5 shrink-0" aria-label="첨부 있음" />}<span className="truncate">{a.title || "(제목 없음)"}</span><ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="아마란스에서 열기" /></span>
              {a.waitingDays != null && <Badge variant={a.waitingDays >= 3 ? "destructive" : "outline"} className="shrink-0 font-normal">{a.waitingDays === 0 ? "오늘" : `${a.waitingDays}일째`}</Badge>}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{[a.form, [a.drafter, a.dept && `(${a.dept})`].filter(Boolean).join(" "), a.arrived && `도착 ${a.arrived}`, a.status].filter(Boolean).join(" · ")}</p>
          </a>
        </li>)}
      </ul>)}
    </div>
  );
}
