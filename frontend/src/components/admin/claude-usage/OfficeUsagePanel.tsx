"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import SortableTable, { sumBy, type Column } from "./SortableTable";
import DailyBars from "./DailyBars";
import { int } from "./format";
import { surfaceLabel, surfacesText, type OfficeSummary, type OfficeUserRow } from "@/lib/claude-usage/office-usage";

/** API가 사용자 행에 붙여 주는 이름·소속(어드민은 조직도, 개인은 스코프 멤버) */
export type OfficeUserView = OfficeUserRow & {
  employee_name?: string | null;
  team?: string | null;
  parent_unit?: string | null;
  headquarters?: string | null;
  division?: string | null;
};

export type OfficeData = Omit<OfficeSummary, "users"> & { users: OfficeUserView[]; notReady?: boolean };

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const perTurn = (inTok: number, outTok: number, turns: number) => (turns ? `${int(inTok / turns)} / ${int(outTok / turns)}` : "—");

export function officeUserColumns(opts: { showUnit: boolean; showOrgs: boolean; orgName?: (id: string) => string }): Column<OfficeUserView>[] {
  const cols: Column<OfficeUserView>[] = [
    { key: "user", header: "사용자", value: (r) => r.employee_name ?? r.user_email, render: (r) => (
      <div><div className="font-medium">{r.employee_name ?? r.user_email.split("@")[0]}</div><div className="text-muted-foreground">{r.user_email}</div></div>) },
  ];
  if (opts.showUnit) {
    cols.push({ key: "team", header: "조직 / 팀", value: (r) => `${r.parent_unit ?? r.headquarters ?? ""} ${r.team ?? ""}`.trim(), render: (r) => {
      if (!r.team) return <span className="text-muted-foreground">—</span>;
      const p = r.parent_unit ?? r.headquarters ?? r.division;
      return <div><div>{r.team}</div>{p && p !== r.team && <div className="text-muted-foreground">{p}</div>}</div>;
    } });
  }
  if (opts.showOrgs) {
    cols.push({ key: "orgs", header: "Claude 조직", value: (r) => r.orgs.join(","), render: (r) => (
      <div className="flex flex-wrap gap-1">{r.orgs.map((o) => <Badge key={o} variant="outline" className="text-[10px]">{opts.orgName?.(o) ?? o.slice(0, 8)}</Badge>)}</div>) });
  }
  cols.push(
    { key: "surfaces", header: "앱별 턴", value: (r) => Object.keys(r.surfaces).sort().join(","), render: (r) => (
      <div className="flex flex-wrap gap-1">{Object.entries(r.surfaces).filter(([, n]) => n > 0).map(([s, n]) => <Badge key={s} variant="secondary" className="text-[10px]">{surfaceLabel(s)} {int(n)}</Badge>)}</div>) },
    { key: "turns", header: "턴", align: "right", value: (r) => r.turns, render: (r) => <span title="사용자가 프롬프트를 보낸 횟수(agent.query 스팬)">{int(r.turns)}</span>, total: "sum" },
    { key: "sessions", header: "세션", align: "right", value: (r) => r.sessions, render: (r) => int(r.sessions), total: "sum" },
    { key: "days", header: "활성일", align: "right", value: (r) => r.active_days, render: (r) => int(r.active_days), total: "sum" },
    { key: "calls", header: "모델 호출", align: "right", value: (r) => r.model_calls, render: (r) => int(r.model_calls), total: "sum" },
    { key: "in", header: "입력 토큰", align: "right", value: (r) => r.input_tokens, render: (r) => int(r.input_tokens), total: "sum" },
    { key: "out", header: "출력 토큰", align: "right", value: (r) => r.output_tokens, render: (r) => int(r.output_tokens), total: "sum" },
    { key: "cache", header: "캐시 읽기", align: "right", value: (r) => r.cache_read_tokens, render: (r) => int(r.cache_read_tokens), total: "sum" },
    { key: "perTurn", header: "토큰/턴 (입/출)", align: "right", value: (r) => (r.turns ? r.output_tokens / r.turns : 0), render: (r) => <span title="턴 1건당 평균 토큰 — 입력(캐시 읽기 제외) / 출력">{perTurn(r.input_tokens, r.output_tokens, r.turns)}</span>, total: (rows) => perTurn(sumBy(rows, (r) => r.input_tokens), sumBy(rows, (r) => r.output_tokens), sumBy(rows, (r) => r.turns)) },
    { key: "tools", header: "도구 호출 (실패)", align: "right", value: (r) => r.tool_calls, render: (r) => `${int(r.tool_calls)} (${int(r.tool_errors)})`, total: (rows) => `${int(sumBy(rows, (r) => r.tool_calls))} (${int(sumBy(rows, (r) => r.tool_errors))})` },
    { key: "files", header: "파일 업로드", align: "right", value: (r) => r.file_uploads, render: (r) => int(r.file_uploads), total: "sum" },
  );
  return cols;
}

/**
 * Office 추가 기능 사용량 패널 — 지표 카드 + 일별 턴 막대 + 사용자 표. 어드민 탭과 개인 화면이 공용으로 쓴다.
 * users는 이미 필터된 행을 받는다(총계 행은 그 필터 기준).
 */
export default function OfficeUsagePanel({ data, users, showUnit, showOrgs, orgName, showTable = true, title, loading, header }: {
  data: OfficeData | null;
  users: OfficeUserView[];
  showUnit: boolean;
  showOrgs: boolean;
  orgName?: (id: string) => string;
  showTable?: boolean;
  title?: string;
  loading?: boolean;
  header?: ReactNode;
}) {
  const t = data?.totals ?? null;
  const surfaces = data?.surfaces ?? [];
  const columns = officeUserColumns({ showUnit, showOrgs, orgName });
  return (
    <div className="space-y-4">
      {t && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="턴" value={int(t.turns)} sub="프롬프트를 보낸 횟수" />
          <Stat label="활성 사용자" value={int(t.active_users)} sub={`활성일 합 ${int(t.active_days)}`} />
          <Stat label="세션" value={int(t.sessions)} />
          <Stat label="입력 / 출력 토큰" value={`${int(t.input_tokens)} / ${int(t.output_tokens)}`} sub={`캐시 읽기 ${int(t.cache_read_tokens)}`} />
          <Stat label="도구 호출 (실패)" value={`${int(t.tool_calls)} (${int(t.tool_errors)})`} sub={`파일 업로드 ${int(t.file_uploads)}`} />
          <Stat label="앱별 턴" value={surfaces.length ? surfaces.map((s) => `${s.label} ${int(s.turns)}`).join(" · ") : "—"} sub={surfaces.length ? surfaces.map((s) => `${s.label} ${int(s.users)}명`).join(" · ") : undefined} />
        </div>
      )}

      {data && data.daily.some((d) => d.turns > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">일별 턴</CardTitle></CardHeader>
          <CardContent><DailyBars data={data.daily} valueKey="turns" label="턴 / 일" format={(v) => int(v)} /></CardContent>
        </Card>
      )}

      {showTable && (
        <Card>
          <CardHeader className="pb-2">
            {header}
            <CardTitle className="text-sm">{title ?? `사용자별 Office 추가 기능 사용량 (${users.length}명)`}</CardTitle>
            <p className="text-xs text-muted-foreground">턴 = 프롬프트 1건. 토큰은 턴 안의 모델 호출을 합한 값이고 캐시 읽기는 입력에 포함하지 않습니다. 앱별 턴은 Excel·Word·PowerPoint·Outlook 구분. 프롬프트 원문·문서 내용은 저장하지 않습니다.</p>
          </CardHeader>
          <CardContent>
            <SortableTable totalLabel={`총계 (${users.length}명)`} rows={users} columns={columns} rowKey={(r) => r.user_email} defaultSort={{ key: "turns", dir: "desc" }} emptyText={loading ? "불러오는 중..." : "기간 내 수집된 Office 추가 기능 사용이 없습니다."} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export { surfacesText };
