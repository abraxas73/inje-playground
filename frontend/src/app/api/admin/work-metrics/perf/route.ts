import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { buildPerfReport, type PerfMember } from "@/lib/work-metrics/perf-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/admin/work-metrics/perf?from&to&team — 성과 지표 전체 조회(admin 전용).
 * 기본은 전체(무필터 — 조직도 밖 이메일도 데이터에 있으면 포함), team 지정 시 그 팀만.
 * 집계는 개인용(/api/usage/perf)과 공용 — lib/work-metrics/perf-report.ts.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("30d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;
  const team = sp.get("team")?.trim() || null;

  const dir = await admin.from("company_directory").select("email, name, team").eq("active", true).limit(1000);
  if (dir.error) return NextResponse.json({ error: dir.error.message }, { status: 500 });
  const all: PerfMember[] = (dir.data ?? []).map((r) => ({
    email: (r.email as string).toLowerCase(),
    name: (r.name as string | null) ?? null,
    team: (r.team as string | null) ?? null,
  }));
  const teams = [...new Set(all.map((m) => m.team).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, "ko"));
  const members = team ? all.filter((m) => m.team === team) : all;
  const filterEmails = team ? members.map((m) => m.email) : null;
  if (team && members.length === 0) return NextResponse.json({ error: `팀을 찾을 수 없습니다: ${team}` }, { status: 400 });

  const result = await buildPerfReport(admin, { from, to, members, filterEmails });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    range: { from, to },
    scope: { scope: "org", scopeLabel: team ? `${team} (${members.length}명)` : `전체 (${members.length}명)` },
    teams,
    ...result.report,
  });
}
