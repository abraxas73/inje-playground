import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { buildPerfReport } from "@/lib/work-metrics/perf-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/usage/perf?from&to — 개인/조직장용 성과 지표(어드민 아님).
 * 범위는 서버가 resolveUsageScope로 결정(본인/조직장은 말단 조직 전체).
 * 집계 로직은 어드민(/api/admin/work-metrics/perf)과 공용 — lib/work-metrics/perf-report.ts.
 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const emails = scope.members.map((m) => m.email);

  const result = await buildPerfReport(admin, { from, to, members: scope.members, filterEmails: emails });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: scope.scopeLabel },
    ...result.report,
  });
}
