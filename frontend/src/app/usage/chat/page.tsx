"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Loader2, MessagesSquare } from "lucide-react";
import SortableTable, { sumBy, type Column } from "@/components/admin/claude-usage/SortableTable";
import PeriodSelect from "@/components/admin/claude-usage/PeriodSelect";
import UnitFilter, { matchUnit } from "@/components/admin/claude-usage/UnitFilter";
import { usd, int, fmtDateTime } from "@/components/admin/claude-usage/format";
import { hasSeat, isIdleSeat } from "@/lib/claude-usage/aggregate";
import { aggregateChatTeams, type ChatTeamRow } from "@/lib/claude-usage/chat-team-summary";
import { mergeMembersByEmail } from "@/lib/claude-usage/chat-member-merge";
import { downloadCsv } from "@/lib/claude-usage/csv-download";
import type { CsvImport, MemberActivityRow } from "@/types/claude-usage";

type Row = MemberActivityRow & {
  org_id: string; import_id: string;
  employee_name: string | null; team: string | null; parent_unit: string | null; headquarters: string | null; division: string | null;
  code_prompts: number; code_prompts_auto: number;
};
interface Resp {
  period: { from: string; to: string } | null;
  collected_at: string | null;
  imports: Pick<CsvImport, "org_id" | "period_start" | "period_end">[];
  scope: { scope: "self" | "org"; scopeLabel: string };
  rows: Row[];
}

function Stat({ label, value, sub, title }: { label: string; value: string; sub?: string; title?: string }) {
  return (
    <div className="rounded-lg border p-3" title={title}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function unitCell(r: { team: string | null; parent_unit: string | null; headquarters: string | null; division: string | null }) {
  if (!r.team) return <span className="text-muted-foreground">—</span>;
  const p = r.parent_unit ?? r.headquarters ?? r.division;
  return (
    <div title={[r.division, r.headquarters, r.parent_unit, r.team].filter((v, i, arr) => v && arr.indexOf(v) === i).join(" > ")}>
      <div>{r.team}</div>
      {p && p !== r.team && <div className="text-muted-foreground">{p}</div>}
    </div>
  );
}

export default function MyChatUsagePage() {
  const [periodEnd, setPeriodEnd] = useState("latest");
  const [unit, setUnit] = useState("all");
  const [q, setQ] = useState("");
  const [idleOnly, setIdleOnly] = useState(false);
  const [result, setResult] = useState<{ key: string; data?: Resp; error?: string } | null>(null);
  const requestKey = periodEnd;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/usage/chat?periodEnd=${encodeURIComponent(periodEnd)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as Resp; })
      .then((j) => { if (!cancelled) setResult({ key: requestKey, data: j }); })
      .catch((e) => { if (!cancelled) setResult({ key: requestKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [periodEnd, requestKey]);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;
  const error = result?.key === requestKey ? result.error ?? null : null;
  // 기간 옵션은 응답이 갈려도 흔들리지 않게 마지막으로 받은 목록을 유지
  const imports = result?.data?.imports ?? [];

  const isTeamView = data?.scope.scope === "org";
  const merged = useMemo(() => mergeMembersByEmail(data?.rows ?? []), [data]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return merged.filter((r) => matchUnit(r, unit)
      && (!s || r.email.toLowerCase().includes(s) || (r.name ?? "").toLowerCase().includes(s) || (r.employee_name ?? "").toLowerCase().includes(s) || (r.team ?? "").toLowerCase().includes(s))
      && (!idleOnly || isIdleSeat(r)));
  }, [merged, unit, q, idleOnly]);
  const idleCount = useMemo(() => merged.filter(isIdleSeat).length, [merged]);
  const distinctTeams = useMemo(() => new Set(merged.map((r) => r.team ?? "명부 없음")).size, [merged]);
  const showTeams = isTeamView && distinctTeams > 1;
  const teamRows = useMemo(() => (showTeams ? aggregateChatTeams(rows) : []), [rows, showTeams]);
  const mine = !isTeamView && merged.length === 1 ? merged[0] : null;

  const totals = useMemo(() => rows.reduce((a, r) => ({
    chats: a.chats + r.chats, messages: a.messages + r.messages, code: a.code + r.code_sessions,
    cowork: a.cowork + r.cowork_sessions, cwmsg: a.cwmsg + r.cowork_messages,
    proj: a.proj + r.projects_used, art: a.art + r.artifacts_created,
    cp: a.cp + r.code_prompts, cpa: a.cpa + r.code_prompts_auto, spend: a.spend + r.estimated_spend_usd,
  }), { chats: 0, messages: 0, code: 0, cowork: 0, cwmsg: 0, proj: 0, art: 0, cp: 0, cpa: 0, spend: 0 }), [rows]);

  const columns: Column<Row>[] = [
    { key: "user", header: "구성원", value: (r) => r.employee_name ?? r.name ?? r.email, render: (r) => (
      <div><div className="font-medium">{r.employee_name ?? r.name ?? r.email.split("@")[0]}</div><div className="text-muted-foreground">{r.email}</div></div>) },
    ...(distinctTeams > 1 ? [{ key: "team", header: "조직 / 팀", value: (r: Row) => `${r.parent_unit ?? r.headquarters ?? ""} ${r.team ?? ""}`.trim(), render: unitCell } satisfies Column<Row>] : []),
    { key: "tier", header: "시트", value: (r) => r.seat_tier ?? "", render: (r) => (hasSeat(r.seat_tier) ? r.seat_tier : <span className="text-muted-foreground">미할당</span>) },
    { key: "last", header: "마지막 활동", value: (r) => r.last_active ?? "" },
    { key: "days", header: "활동일", align: "right", value: (r) => r.days_active, render: (r) => int(r.days_active), total: "sum" },
    { key: "codep", header: "Claude Code 프롬프트 (사람 / 자동)", align: "right", value: (r) => r.code_prompts, render: (r) => <span title="같은 데이터 기간의 Claude Code 프롬프트 수(OTel) — 사람이 친 것 / 플러그인·스크립트 자동화. 채팅이 0이어도 Claude Code를 쓰는지 구분용">{`${int(r.code_prompts)} / ${int(r.code_prompts_auto)}`}</span>, total: (rows) => `${int(sumBy(rows, (r) => r.code_prompts))} / ${int(sumBy(rows, (r) => r.code_prompts_auto))}` },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats, render: (r) => int(r.chats), total: "sum" },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages, render: (r) => int(r.messages), total: "sum" },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions, render: (r) => int(r.code_sessions), total: "sum" },
    { key: "prs", header: "PR", align: "right", value: (r) => r.pull_requests, render: (r) => int(r.pull_requests), total: "sum" },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions, render: (r) => int(r.cowork_sessions), total: "sum" },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages, render: (r) => int(r.cowork_messages), total: "sum" },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used, render: (r) => int(r.projects_used), total: "sum" },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created, render: (r) => int(r.artifacts_created), total: "sum" },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.estimated_spend_usd, render: (r) => usd(r.estimated_spend_usd), total: (rows) => usd(sumBy(rows, (r) => r.estimated_spend_usd)) },
  ];

  const maxMessages = Math.max(1, ...teamRows.map((r) => r.messages));
  const teamColumns: Column<ChatTeamRow>[] = [
    { key: "team", header: "팀 / 센터", value: (r) => r.team, render: (r) => (
      <div><div className="font-medium">{r.team}</div>{r.parent && <div className="text-muted-foreground">{r.parent}</div>}</div>) },
    { key: "users", header: "활동자/시트", align: "right", value: (r) => r.users, render: (r) => <span title="기간 내 활동일이 있는 인원 / 이 팀에서 Claude 시트를 가진 인원">{`${r.active_users}/${r.users}`}</span>, total: (rows) => `${sumBy(rows, (r) => r.active_users)}/${sumBy(rows, (r) => r.users)}` },
    { key: "msgs", header: "메시지", align: "right", value: (r) => r.messages, render: (r) => (
      <div className="flex items-center justify-end gap-2">
        <div className="h-2 rounded bg-primary/20" style={{ width: `${Math.max(2, Math.round((r.messages / maxMessages) * 90))}px` }} />
        <span>{int(r.messages)}</span>
      </div>), total: (rows) => int(sumBy(rows, (r) => r.messages)) },
    { key: "msgsPerUser", header: "메시지/활동자", align: "right", value: (r) => (r.active_users ? r.messages / r.active_users : 0), render: (r) => (r.active_users ? int(Math.round(r.messages / r.active_users)) : "—"), total: (rows) => { const a = sumBy(rows, (r) => r.active_users); return a ? int(Math.round(sumBy(rows, (r) => r.messages) / a)) : "—"; } },
    { key: "chats", header: "채팅", align: "right", value: (r) => r.chats, render: (r) => int(r.chats), total: "sum" },
    { key: "code", header: "코드 세션", align: "right", value: (r) => r.code_sessions, render: (r) => int(r.code_sessions), total: "sum" },
    { key: "cowork", header: "Cowork 세션", align: "right", value: (r) => r.cowork_sessions, render: (r) => int(r.cowork_sessions), total: "sum" },
    { key: "cwmsg", header: "Cowork 메시지", align: "right", value: (r) => r.cowork_messages, render: (r) => int(r.cowork_messages), total: "sum" },
    { key: "proj", header: "프로젝트", align: "right", value: (r) => r.projects_used, render: (r) => int(r.projects_used), total: "sum" },
    { key: "art", header: "아티팩트", align: "right", value: (r) => r.artifacts_created, render: (r) => int(r.artifacts_created), total: "sum" },
    { key: "spend", header: "초과 지출", align: "right", value: (r) => r.spend_usd, render: (r) => usd(r.spend_usd), total: (rows) => usd(sumBy(rows, (r) => r.spend_usd)) },
  ];

  const periodSuffix = data?.period ? `-${data.period.from}-to-${data.period.to}` : "";
  const exportMembersCsv = () => {
    const head = ["email", "name", "team", "parent_unit", "seat_tier", "last_active", "days_active", "code_prompts_human", "code_prompts_auto", "chats", "messages", "code_sessions", "pull_requests", "cowork_sessions", "cowork_messages", "projects_used", "artifacts_created", "estimated_spend_usd"];
    downloadCsv(`my-claude-chat-usage${periodSuffix}.csv`, head, rows.map((r) => [r.email, r.employee_name ?? r.name ?? "", r.team ?? "", r.parent_unit ?? "", r.seat_tier ?? "", r.last_active ?? "", r.days_active, r.code_prompts, r.code_prompts_auto, r.chats, r.messages, r.code_sessions, r.pull_requests, r.cowork_sessions, r.cowork_messages, r.projects_used, r.artifacts_created, r.estimated_spend_usd.toFixed(2)]));
  };
  const exportTeamsCsv = () => {
    const head = ["team", "parent", "active_users", "users", "chats", "messages", "code_sessions", "cowork_sessions", "cowork_messages", "projects_used", "artifacts_created", "spend_usd"];
    downloadCsv(`my-claude-chat-by-team${periodSuffix}.csv`, head, teamRows.map((r) => [r.team, r.parent ?? "", r.active_users, r.users, r.chats, r.messages, r.code_sessions, r.cowork_sessions, r.cowork_messages, r.projects_used, r.artifacts_created, r.spend_usd.toFixed(2)]));
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 md:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <MessagesSquare className="h-5 w-5" />내 Claude 사용량 (Chat/Cowork)
          {data && <Badge variant="secondary" className="ml-1">{data.scope.scopeLabel}</Badge>}
        </h1>
        <p className="text-sm text-muted-foreground">
          claude.ai 채팅 · Cowork 활동(30일 롤링, 매일 수집되는 멤버 활동 CSV 스냅샷). 조직장(팀장·센터장·본부장)은 소속 구성원까지 보입니다.
          Claude in Chrome(사이드 패널) 사용은 Cowork 세션·메시지에 포함되고 따로 구분되지 않습니다. Excel·Word·PowerPoint 추가 기능 사용은 Team 플랜 분석에 제공되지 않아 여기 잡히지 않습니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodSelect value={periodEnd} onChange={setPeriodEnd} imports={imports} />
        {data?.period && (
          <Badge variant="secondary" title={data.collected_at ? `수집 ${fmtDateTime(data.collected_at)}` : undefined}>
            데이터 기간 {data.period.from} ~ {data.period.to}{data.collected_at ? ` · 수집 ${fmtDateTime(data.collected_at)}` : ""}
          </Badge>
        )}
        {isTeamView && (
          <>
            {distinctTeams > 1 && <UnitFilter value={unit} onChange={setUnit} rows={merged} />}
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름/이메일 검색" className="h-8 w-[180px] text-xs" />
            <Button size="sm" variant={idleOnly ? "default" : "outline"} onClick={() => setIdleOnly((v) => !v)} title="시트는 있는데 기간 내 채팅·코드·Cowork 세션이 모두 0인 구성원">노는 시트만 ({idleCount})</Button>
            <Button size="sm" variant="outline" onClick={exportMembersCsv} disabled={rows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
          </>
        )}
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="채팅 · 메시지" value={`${int(totals.chats)} · ${int(totals.messages)}`} />
          <Stat label="코드 세션" value={int(totals.code)} />
          <Stat label="Cowork 세션 · 메시지" value={`${int(totals.cowork)} · ${int(totals.cwmsg)}`} />
          <Stat label="프로젝트 · 아티팩트" value={`${int(totals.proj)} · ${int(totals.art)}`} />
          <Stat label="Claude Code 프롬프트 (사람 / 자동)" value={`${int(totals.cp)} / ${int(totals.cpa)}`} sub="같은 데이터 기간 · OTel 수집" title="사람이 친 프롬프트 / 플러그인·스크립트 자동화. 내용 수집이 없는 사용자는 전부 사람으로 잡힘" />
          <Stat label="초과 지출" value={usd(totals.spend)} sub="시트 한도 초과 추정액(CSV)" />
        </div>
      )}

      {showTeams && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">팀별 채팅 · Cowork 활동 ({teamRows.length}개 팀 · 사내 조직도 기준)</CardTitle>
              <Button size="sm" variant="outline" onClick={exportTeamsCsv} disabled={teamRows.length === 0}><Download className="mr-1 h-3.5 w-3.5" />CSV</Button>
            </div>
            <p className="text-xs text-muted-foreground">팀 = 조직도 말단 부서(팀·센터), 아래 줄은 바로 위 조직. &quot;활동자/시트&quot;는 기간 내 활동일이 있는 인원 / 이 팀에서 Claude 시트를 가진 인원.</p>
          </CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${teamRows.length}개 팀)`} rows={teamRows} columns={teamColumns} rowKey={(r) => r.team} defaultSort={{ key: "msgs", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
          </CardContent>
        </Card>
      )}

      {isTeamView && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">구성원별 ({rows.length}명) — 노는 시트는 붉게 표시</CardTitle></CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${rows.length}명)`} rows={rows} columns={columns} rowKey={(r) => r.email} defaultSort={{ key: "msgs", dir: "desc" }} rowClassName={(r) => (isIdleSeat(r) ? "bg-destructive/5" : "")} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다."} />
          </CardContent>
        </Card>
      )}

      {!loading && !error && merged.length === 0 && (
        <p className="text-sm text-muted-foreground">아직 수집된 활동이 없습니다. 멤버 활동 CSV 수집 이후 표시됩니다.</p>
      )}
      {mine && (
        <p className="text-xs text-muted-foreground">
          시트 {hasSeat(mine.seat_tier) ? mine.seat_tier : "미할당"} · 마지막 활동 {mine.last_active ?? "—"} · 활동일 {int(mine.days_active)}일
        </p>
      )}
    </div>
  );
}
