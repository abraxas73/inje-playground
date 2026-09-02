import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { buildPerfReport, type PerfMember } from "@/lib/work-metrics/perf-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/admin/work-metrics/perf?from&to&team&q — 성과 지표 전체 조회(admin 전용).
 * 기본은 전체(무필터 — 조직도 밖 이메일도 데이터에 있으면 포함), team 지정 시 그 팀만,
 * q는 이름/이메일 부분 일치 검색(팀 필터와 교집합; 조직도 미등록자는 전체 이메일로 검색 가능).
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
  const q = (sp.get("q") ?? "").trim().toLowerCase() || null;

  const dir = await admin.from("company_directory").select("email, name, team").eq("active", true).limit(1000);
  if (dir.error) return NextResponse.json({ error: dir.error.message }, { status: 500 });
  const all: PerfMember[] = (dir.data ?? []).map((r) => ({
    email: (r.email as string).toLowerCase(),
    name: (r.name as string | null) ?? null,
    team: (r.team as string | null) ?? null,
  }));
  const teams = [...new Set(all.map((m) => m.team).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, "ko"));
  let members = team ? all.filter((m) => m.team === team) : all;
  if (team && members.length === 0) return NextResponse.json({ error: `팀을 찾을 수 없습니다: ${team}` }, { status: 400 });
  if (q) {
    members = members.filter((m) => m.email.includes(q) || (m.name ?? "").toLowerCase().includes(q));
    if (members.length === 0 && q.includes("@")) members = [{ email: q, name: null, team: null }];
  }
  // 검색 결과 0명이어도 400 대신 빈 결과(타이핑 중 UX) — 매칭 불가 센티널로 무필터 폴백 방지
  const filterEmails = team || q ? (members.length ? members.map((m) => m.email) : ["__no_match__"]) : null;

  const result = await buildPerfReport(admin, { from, to, members, filterEmails });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });

  return NextResponse.json({
    range: { from, to },
    scope: { scope: "org", scopeLabel: (() => {
      const label = [team, q ? `"${q}"` : null].filter(Boolean).join(" · ");
      return label ? `${label} (${members.length}명)` : `전체 (${members.length}명)`;
    })() },
    teams,
    ...result.report,
  });
}
