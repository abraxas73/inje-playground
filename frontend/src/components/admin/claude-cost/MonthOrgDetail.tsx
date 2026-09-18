"use client";

import { Badge } from "@/components/ui/badge";
import SortableTable, { type Column } from "@/components/admin/claude-usage/SortableTable";
import { usd, int } from "@/components/admin/claude-usage/format";
import { formatCents } from "@/lib/claude-cost/money";
import { SEATS_HINT, ACTIVE_USERS_HINT, EST_COST_HINT } from "@/lib/claude-cost/hints";
import type { MonthlyCost, MonthlyOrgCost } from "@/types/claude-cost";

/** 한 달의 조직별 청구·인보이스·사용량. 인보이스는 장별로 번호·발행일·기간·PDF 링크 */
export default function MonthOrgDetail({ month }: { month: MonthlyCost }) {
  const columns: Column<MonthlyOrgCost>[] = [
    { key: "name", header: "조직", value: (o) => o.name, render: (o) => (o.orgId === null ? <Badge variant="destructive">{o.name}</Badge> : o.name) },
    { key: "invoices", header: "인보이스", value: (o) => o.invoices.length,
      render: (o) => (o.invoices.length === 0 ? <span className="text-destructive">없음</span> : (
        <div className="space-y-0.5 text-xs">
          {o.invoices.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-x-2">
              <span className="font-mono">{i.invoice_number}</span>
              <span className="text-muted-foreground">{i.issued_on}{i.period_start && i.period_end ? ` · ${i.period_start}~${i.period_end}` : ""}</span>
              <a className="underline" href={`/api/admin/claude-cost/invoices/${i.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
              {i.source_url && <a className="underline text-muted-foreground" href={i.source_url} target="_blank" rel="noreferrer">원본</a>}
            </div>
          ))}
        </div>
      )) },
    { key: "plan", header: "티어", value: (o) => o.plan ?? "", render: (o) => o.plan ?? "—" },
    { key: "seats", header: "좌석", hint: SEATS_HINT, value: (o) => o.seats, align: "right", total: (rows) => int(rows.reduce((a, r) => a + (r.seats ?? 0), 0)) },
    { key: "total", header: "청구 총액", value: (o) => o.totalCents / 100, align: "right", render: (o) => formatCents(o.totalCents), total: (rows) => formatCents(rows.reduce((a, r) => a + r.totalCents, 0)) },
    { key: "perSeat", header: "좌석당", value: (o) => (o.seats ? o.totalCents / 100 / o.seats : null), align: "right", render: (o) => (o.seats ? formatCents(o.totalCents / o.seats) : "—") },
    { key: "active", header: "Claude Code\n활성 사용자", hint: ACTIVE_USERS_HINT, value: (o) => o.activeUsers, align: "right", total: "sum" },
    { key: "perUser", header: "1인당", value: (o) => (o.activeUsers ? o.totalCents / 100 / o.activeUsers : null), align: "right", render: (o) => (o.activeUsers ? formatCents(o.totalCents / o.activeUsers) : "—") },
    { key: "est", header: "추정 비용\n(OTel)", hint: EST_COST_HINT, value: (o) => o.estCostUsd, align: "right", render: (o) => usd(o.estCostUsd), total: (rows) => usd(rows.reduce((a, r) => a + r.estCostUsd, 0)) },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{month.month} 조직별</span>
        {month.missingOrgs.length > 0 && <Badge variant="outline" className="text-destructive border-destructive/40">인보이스 없음: {month.missingOrgs.join(", ")}</Badge>}
        {month.unassignedCents > 0 && <Badge variant="destructive">미배정 {formatCents(month.unassignedCents)}</Badge>}
      </div>
      <SortableTable rows={month.perOrg} columns={columns} rowKey={(o) => o.orgId ?? "unassigned"} defaultSort={{ key: "total", dir: "desc" }} totalLabel={`총계 (${month.perOrg.length}개 조직)`} emptyText="Team 조직이 없습니다." />
    </div>
  );
}
