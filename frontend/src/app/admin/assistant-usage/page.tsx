"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { TeamUsage, UserUsage } from "@/lib/chat/usage-report";

const n = (v: number) => v.toLocaleString("ko-KR");

/** 이노봇 사용량 — 사용자·팀별 턴·토큰·Opus 비율·가린 건수. 대화 본문은 관리자도 볼 수 없다. */
export default function AssistantUsagePage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<{ from: string; users: UserUsage[]; teams: TeamUsage[] } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/assistant-usage?days=${days}`).then(async (r) => {
      const j = await r.json();
      if (!alive) return;
      if (!r.ok) setError(j.error ?? "불러오지 못했습니다."); else { setError(""); setData(j); }
    }).catch(() => alive && setError("불러오지 못했습니다."));
    return () => { alive = false; };
  }, [days]);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">이노봇 사용량</h1>
        <select aria-label="기간" className="rounded-md border bg-background px-2 py-1 text-sm" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>최근 7일</option><option value={30}>최근 30일</option><option value={90}>최근 90일</option>
        </select>
      </div>
      <p className="text-sm text-muted-foreground">턴은 Claude 호출 횟수입니다. 대화 본문은 저장한 사람만 볼 수 있고, 이 화면에는 건수만 나옵니다.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {data && (
        <>
          <Card><CardHeader><CardTitle className="text-base">팀별</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">팀</th><th>사용자</th><th>턴</th><th>입력 토큰</th><th>출력 토큰</th></tr></thead>
              <tbody>{data.teams.map((t) => <tr key={t.team} className="border-t"><td className="py-1">{t.team}</td><td>{n(t.users)}</td><td>{n(t.turns)}</td><td>{n(t.inputTokens)}</td><td>{n(t.outputTokens)}</td></tr>)}</tbody></table>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">사용자별</CardTitle></CardHeader><CardContent className="overflow-x-auto">
            <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">이름</th><th>팀</th><th>턴</th><th>Opus 비율</th><th>입력 토큰</th><th>출력 토큰</th><th>가린 개인정보</th></tr></thead>
              <tbody>{data.users.map((u) => <tr key={u.userId} className="border-t"><td className="py-1">{u.name}</td><td>{u.team}</td><td>{n(u.turns)}</td><td>{u.turns ? Math.round((u.opusTurns / u.turns) * 100) : 0}%</td><td>{n(u.inputTokens)}</td><td>{n(u.outputTokens)}</td><td>{n(u.masked)}</td></tr>)}</tbody></table>
            {!data.users.length && <p className="py-4 text-center text-sm text-muted-foreground">{data.from} 이후 사용 기록이 없습니다.</p>}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}
