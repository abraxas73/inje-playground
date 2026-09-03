import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { buildPerfReport, type PerfMember } from "@/lib/work-metrics/perf-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/usage/perf?from&to&team&q — 개인/조직장용 성과 지표(어드민 아님).
 * 범위는 서버가 resolveUsageScope로 결정(본인/조직장은 말단 조직 전체). team·q는 그 범위 안에서만 좁히는 필터라
 * 어떤 값을 보내도 허용 범위 밖은 나오지 않는다. 조직장 범위에 팀이 둘 이상이면(센터장·본부장) teams를 내려 팀 필터를 띄운다.
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
  const team = sp.get("team")?.trim() || null;
  const q = (sp.get("q") ?? "").trim().toLowerCase() || null;

  const all: PerfMember[] = scope.members.map((m) => ({ email: m.email, name: m.name, team: m.team }));
  const teams = [...new Set(all.map((m) => m.team).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, "ko"));
  let members = team ? all.filter((m) => m.team === team) : all;
  if (q) members = members.filter((m) => m.email.includes(q) || (m.name ?? "").toLowerCase().includes(q));
  // 필터 결과 0명이면 빈 결과(무필터 폴백으로 범위가 넓어지지 않도록 매칭 불가 센티널)
  const filterEmails = members.length ? members.map((m) => m.email) : ["__no_match__"];

  const result = await buildPerfReport(admin, { from, to, members, filterEmails });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  const filterLabel = [team, q ? `"${q}"` : null].filter(Boolean).join(" · ");
  return NextResponse.json({
    range: { from, to },
    scope: { scope: scope.scope, scopeLabel: filterLabel ? `${filterLabel} (${members.length}명)` : scope.scopeLabel },
    ...(scope.scope === "org" && teams.length > 1 ? { teams } : {}),
    ...result.report,
  });
}
