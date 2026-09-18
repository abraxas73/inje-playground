"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2 } from "lucide-react";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import OrgSelect from "@/components/admin/claude-usage/OrgSelect";
import { usd, int } from "@/components/admin/claude-usage/format";
import { downloadCsv } from "@/lib/claude-usage/csv-download";
import { formatCents } from "@/lib/claude-cost/money";
import { ACTIVE_USERS_HINT, API_COST_HINT, BASIS_ISSUED_HINT, BASIS_PERIOD_HINT, BILLED_HINT, CSV_ACTIVE_HINT, EST_COST_HINT, MISSING_HINT, PER_SEAT_HINT, PER_USER_HINT, SEATS_HINT } from "@/lib/claude-cost/hints";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import MonthlyBars from "./MonthlyBars";
import MonthOrgDetail from "./MonthOrgDetail";
import type { ClaudeOrg } from "@/types/claude-usage";
import type { MonthBasis, MonthlyCost, MonthlyTier } from "@/types/claude-cost";

interface MonthlyResponse { months: MonthlyCost[]; basis: MonthBasis; apiCostAvailable: boolean; orgs: ClaudeOrg[] }
const BASIS_LABEL: Record<MonthBasis, string> = { issued: "발행일 기준", period: "서비스 기간 일할" };

// 인보이스가 없는 달은 청구가 0이 아니라 "모름"이라 파생 지표를 비운다
const perSeat = (m: MonthlyCost): number | null => (m.invoices && m.seats ? m.billed.totalCents / m.seats : null);
/** "Team plan - Premium" → "Premium" (표 칸이 좁아 접두를 뗀다) */
const tierLabel = (plan: string): string => plan.replace(/^Team plan\s*-\s*/i, "");
const tiersWithSeats = (m: MonthlyCost): MonthlyTier[] => m.tiers.filter((t) => (t.seats ?? 0) > 0);
const tierPerSeat = (t: MonthlyTier): number | null => (t.seats ? t.totalCents / t.seats : null);
/** 티어별 한 줄 요약: "Premium 202 · Standard 114" */
const tierSeatsText = (m: MonthlyCost): string => tiersWithSeats(m).map((t) => `${tierLabel(t.plan)} ${int(t.seats ?? 0)}`).join(" · ");
const tierPerSeatText = (m: MonthlyCost): string => tiersWithSeats(m).map((t) => `${tierLabel(t.plan)} ${centsCell(tierPerSeat(t))}`).join(" · ");
const perUser = (m: MonthlyCost): number | null => (m.invoices && m.usage.activeUsers ? m.billed.totalCents / m.usage.activeUsers : null);
const centsCell = (v: number | null): string => (v === null ? "—" : formatCents(v));

/** 월별 청구(인보이스) vs 사용량(OTel·CSV). 기간·조직을 고르고, 월 행을 누르면 조직별 상세 */
export default function CostOverviewTab({ onMeta }: { onMeta: (m: { apiCostAvailable: boolean; orgs: ClaudeOrg[] }) => void }) {
  const [months, setMonths] = useState("12");
  const [org, setOrg] = useState("all");
  // 월 배정 기준은 사람마다 보는 목적이 달라(재무 대조 vs 월별 비교) 브라우저에 기억한다
  const [basis, setBasis] = useLocalStorage<MonthBasis>("claude-cost-basis", "issued");
  const [selected, setSelected] = useState<string | null>(null);
  const key = `${months}|${org}|${basis}`;
  const [result, setResult] = useState<{ key: string; data?: MonthlyResponse; error?: string } | null>(null);
  const loading = result?.key !== key;
  const data = result?.key === key ? result.data ?? null : null;
  const error = result?.key === key ? result.error ?? null : null;

  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/claude-cost/monthly?months=${months}&org=${encodeURIComponent(org)}&basis=${basis}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); return j as MonthlyResponse; })
      .then((j) => { if (alive) { setResult({ key, data: j }); onMeta({ apiCostAvailable: j.apiCostAvailable, orgs: j.orgs }); } })
      .catch((e) => { if (alive) setResult({ key, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [key, months, org, basis, onMeta]);

  const rows = useMemo(() => (data?.months ?? []).slice().reverse(), [data]); // 표는 최신 달이 위
  const showApi = !!data?.apiCostAvailable;
  const latest = useMemo(() => rows.find((m) => m.invoices > 0) ?? null, [rows]);
  const selectedMonth = rows.find((m) => m.month === selected) ?? null;

  const columns: Column<MonthlyCost>[] = [
    { key: "month", header: "월", value: (m) => m.month, render: (m) => (
      <button type="button" className="underline-offset-2 hover:underline font-medium" onClick={() => setSelected(m.month)}>{m.month}</button>) },
    { key: "invoices", header: "인보이스", value: (m) => m.invoices, align: "right", render: (m) => (
      <span className="inline-flex items-center gap-1">{int(m.invoices)}{m.missingOrgs.length > 0 && m.invoices > 0 && <Badge variant="outline" className="text-destructive border-destructive/40 text-[10px]" title={`${MISSING_HINT}\n${m.missingOrgs.join(", ")}`}>누락 {m.missingOrgs.length}</Badge>}{m.unassignedCents > 0 && <Badge variant="destructive" className="text-[10px]">미배정</Badge>}</span>) },
    { key: "seats", header: "좌석", hint: SEATS_HINT, value: (m) => m.seats, align: "right", render: (m) => (m.seats === null ? "—" : (
      <span className="inline-flex flex-col items-end leading-tight">{int(m.seats)}{tiersWithSeats(m).length > 1 && <span className="text-[10px] text-muted-foreground whitespace-nowrap">{tierSeatsText(m)}</span>}</span>)) },
    { key: "subtotal", header: "청구 세전", value: (m) => m.billed.subtotalCents / 100, align: "right", render: (m) => formatCents(m.billed.subtotalCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.subtotalCents, 0)) },
    { key: "tax", header: "VAT", value: (m) => m.billed.taxCents / 100, align: "right", render: (m) => formatCents(m.billed.taxCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.taxCents, 0)) },
    { key: "total", header: "청구 총액", hint: BILLED_HINT, value: (m) => m.billed.totalCents / 100, align: "right", className: "font-semibold", render: (m) => formatCents(m.billed.totalCents), total: (rs) => formatCents(rs.reduce((a, r) => a + r.billed.totalCents, 0)) },
    ...(showApi ? [{ key: "api", header: "API 비용\n(Console)", hint: API_COST_HINT, value: (m: MonthlyCost) => (m.apiCostCents ?? 0) / 100, align: "right" as const, render: (m: MonthlyCost) => formatCents(m.apiCostCents ?? 0), total: (rs: MonthlyCost[]) => formatCents(rs.reduce((a, r) => a + (r.apiCostCents ?? 0), 0)) }] : []),
    { key: "est", header: "추정 비용\n(OTel)", hint: EST_COST_HINT, value: (m) => m.usage.estCostUsd, align: "right", render: (m) => usd(m.usage.estCostUsd), total: (rs) => usd(rs.reduce((a, r) => a + r.usage.estCostUsd, 0)) },
    { key: "active", header: "Claude Code\n활성 사용자", hint: ACTIVE_USERS_HINT, value: (m) => m.usage.activeUsers, align: "right" },
    { key: "csv", header: "활성 멤버\n(CSV)", hint: CSV_ACTIVE_HINT, value: (m) => m.csvActiveMembers, align: "right" },
    { key: "sessions", header: "세션", value: (m) => m.usage.sessions, align: "right", total: "sum" },
    { key: "prompts", header: "사람 프롬프트", value: (m) => m.usage.promptsHuman, align: "right", total: "sum" },
    { key: "perSeat", header: "좌석당", hint: PER_SEAT_HINT, value: (m) => (perSeat(m) === null ? null : (perSeat(m) as number) / 100), align: "right", render: (m) => (perSeat(m) === null ? "—" : (
      <span className="inline-flex flex-col items-end leading-tight">{tiersWithSeats(m).length > 1 ? <><span className="whitespace-nowrap">{tierPerSeatText(m)}</span><span className="text-[10px] text-muted-foreground">평균 {centsCell(perSeat(m))}</span></> : centsCell(perSeat(m))}</span>)) },
    { key: "perUser", header: "1인당", hint: PER_USER_HINT, value: (m) => (perUser(m) === null ? null : (perUser(m) as number) / 100), align: "right", render: (m) => centsCell(perUser(m)) },
  ];

  const exportCsv = () => {
    const tierCol = (m: MonthlyCost, f: (t: MonthlyTier) => string | number) => m.tiers.map((t) => `${tierLabel(t.plan)}:${f(t)}`).join(";");
    const head = ["month", "invoices", "seats", "seats_by_tier", "subtotal_usd", "vat_usd", "total_usd", "total_by_tier_usd", "per_seat_by_tier_usd", ...(showApi ? ["api_cost_usd"] : []), "est_cost_usd", "code_active_users", "csv_active_members", "sessions", "prompts_human", "per_seat_usd", "per_user_usd", "missing_orgs"];
    downloadCsv(`claude-cost-monthly-${months}m-${basis}.csv`, head, rows.map((m) => [m.month, m.invoices, m.seats ?? "", tierCol(m, (t) => t.seats ?? ""), (m.billed.subtotalCents / 100).toFixed(2), (m.billed.taxCents / 100).toFixed(2), (m.billed.totalCents / 100).toFixed(2), tierCol(m, (t) => (t.totalCents / 100).toFixed(2)), tierCol(m, (t) => (tierPerSeat(t) === null ? "" : ((tierPerSeat(t) as number) / 100).toFixed(2))), ...(showApi ? [((m.apiCostCents ?? 0) / 100).toFixed(2)] : []), m.usage.estCostUsd.toFixed(2), m.usage.activeUsers, m.csvActiveMembers ?? "", m.usage.sessions, m.usage.promptsHuman, perSeat(m) === null ? "" : ((perSeat(m) as number) / 100).toFixed(2), perUser(m) === null ? "" : ((perUser(m) as number) / 100).toFixed(2), m.missingOrgs.join("; ")]));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={months} onValueChange={setMonths}>
          <SelectTrigger className="h-8 w-[130px] text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{["6", "12", "24"].map((n) => <SelectItem key={n} value={n}>최근 {n}개월</SelectItem>)}</SelectContent>
        </Select>
        <OrgSelect orgs={data?.orgs ?? []} value={org} onChange={setOrg} />
        <Select value={basis} onValueChange={(v) => setBasis(v as MonthBasis)}>
          <SelectTrigger className="h-8 w-[160px] text-xs" title={basis === "period" ? BASIS_PERIOD_HINT : BASIS_ISSUED_HINT}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="issued" title={BASIS_ISSUED_HINT}>{BASIS_LABEL.issued}</SelectItem>
            <SelectItem value="period" title={BASIS_PERIOD_HINT}>{BASIS_LABEL.period}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" className="h-8" onClick={exportCsv} disabled={!rows.length}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {latest && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">{latest.month} 청구 총액</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{formatCents(latest.billed.totalCents)}<div className="text-xs text-muted-foreground">세전 {formatCents(latest.billed.subtotalCents)} · VAT {formatCents(latest.billed.taxCents)}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">좌석</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{latest.seats === null ? "—" : int(latest.seats)}<div className="text-xs text-muted-foreground">{tiersWithSeats(latest).length ? `${tierSeatsText(latest)} · ` : ""}인보이스 {latest.invoices}장{latest.missingOrgs.length ? ` · 누락 ${latest.missingOrgs.length}개 조직` : ""}</div></CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">좌석당 월 비용{tiersWithSeats(latest).length > 1 ? " (티어별)" : ""}</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{tiersWithSeats(latest).length > 1 ? (
            <div className="space-y-0.5">{tiersWithSeats(latest).map((t) => <div key={t.plan} className="flex items-baseline gap-2"><span className="text-xs font-normal text-muted-foreground w-20">{tierLabel(t.plan)}</span><span>{centsCell(tierPerSeat(t))}</span><span className="text-xs font-normal text-muted-foreground">{int(t.seats ?? 0)}석 · {formatCents(t.totalCents)}</span></div>)}<div className="text-xs font-normal text-muted-foreground">평균 {centsCell(perSeat(latest))}</div></div>
          ) : centsCell(perSeat(latest))}</CardContent></Card>
          <Card><CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground">활성 사용자당</CardTitle></CardHeader><CardContent className="text-2xl font-semibold">{centsCell(perUser(latest))}<div className="text-xs text-muted-foreground">Claude Code 활성 {int(latest.usage.activeUsers)}명{latest.csvActiveMembers !== null ? ` · CSV 활성 ${int(latest.csvActiveMembers)}명` : ""}</div></CardContent></Card>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{basis === "period" ? BASIS_PERIOD_HINT : BASIS_ISSUED_HINT} 누락 배지는 기준과 무관하게 서비스 기간이 그 달을 덮는 인보이스가 없는 조직입니다.</p>
      {data && <MonthlyBars data={data.months} showApi={showApi} />}
      <SortableTable rows={rows} columns={columns} rowKey={(m) => m.month} defaultSort={{ key: "month", dir: "desc" }} totalLabel={`총계 (${rows.length}개월)`} emptyText={loading ? "불러오는 중..." : "데이터가 없습니다. 인보이스 등록 탭에서 Stripe 링크를 등록하세요."} />
      {selectedMonth && <MonthOrgDetail month={selectedMonth} />}
    </div>
  );
}
