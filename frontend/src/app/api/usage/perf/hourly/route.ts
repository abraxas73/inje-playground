import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { contributorsSuppressed, hourlyTargets, loadContributors, loadHourly, parseKinds } from "@/lib/work-metrics/hourly";
import type { HourlyResponse } from "@/types/work-metrics";

export const runtime = "nodejs";

/**
 * GET /api/usage/perf/hourly?from&to&team&kinds — 개인/조직장용 활동 시간대.
 * 본인(scope self)은 본인만. 조직장은 범위 안에서 팀 필터까지만, 구성원이나 활동한 사람이 3명 미만이면 suppressed. 이름 검색은 받지 않는다.
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
  const kinds = parseKinds(sp.get("kinds"));

  const self = scope.scope === "self";
  const members = self ? scope.members.filter((m) => m.email === scope.email) : team ? scope.members.filter((m) => m.team === team) : scope.members;
  const t = hourlyTargets(members, { self });
  const headers = { "Cache-Control": "no-store" };
  const base = { range: { from, to }, scope: { scopeLabel: self ? "내 활동" : team ? `${team} (${members.length}명)` : scope.scopeLabel }, kinds };
  if (t.suppressed) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  if (!self) {
    const contrib = await loadContributors(admin, { from, to, emails: t.emails, kinds });
    if ("error" in contrib) return NextResponse.json({ error: contrib.error }, { status: 500 });
    if (contrib.notReady) return NextResponse.json({ ...base, cells: [], suppressed: false, notReady: true } satisfies HourlyResponse, { headers });
    if (contributorsSuppressed(contrib.contributors, self)) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  }
  const res = await loadHourly(admin, { from, to, emails: t.emails, kinds });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ...base, cells: res.cells, suppressed: false, notReady: res.notReady } satisfies HourlyResponse, { headers });
}
