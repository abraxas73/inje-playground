import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";
import { contributorsSuppressed, hourlyTargets, loadContributors, loadHourly, parseKinds } from "@/lib/work-metrics/hourly";
import type { HourlyResponse } from "@/types/work-metrics";

export const runtime = "nodejs";

/**
 * GET /api/admin/work-metrics/perf/hourly?from&to&team&kinds=commit,issue,mr — 활동 시간대(admin).
 * 팀 필터까지만 받고 이름 검색(q)은 받지 않는다. 팀 구성원이나 기간 내 활동한 사람이 3명 미만이면 suppressed. 개인별 값은 내려가지 않는다(RPC에 사용자 차원 없음).
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
  const kinds = parseKinds(sp.get("kinds"));

  let emails: string[] | null = null;
  let suppressed = false;
  let scopeLabel = "전체";
  if (team) {
    const dir = await admin.from("company_directory").select("email").eq("active", true).eq("team", team).limit(1000);
    if (dir.error) return NextResponse.json({ error: dir.error.message }, { status: 500 });
    const t = hourlyTargets((dir.data ?? []).map((r) => ({ email: r.email as string })), { self: false });
    emails = t.emails; suppressed = t.suppressed; scopeLabel = `${team} (${dir.data?.length ?? 0}명)`;
  }
  const headers = { "Cache-Control": "no-store" };
  const base = { range: { from, to }, scope: { scopeLabel }, kinds };
  if (suppressed) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  const contrib = await loadContributors(admin, { from, to, emails, kinds });
  if ("error" in contrib) return NextResponse.json({ error: contrib.error }, { status: 500 });
  if (contrib.notReady) return NextResponse.json({ ...base, cells: [], suppressed: false, notReady: true } satisfies HourlyResponse, { headers });
  if (contributorsSuppressed(contrib.contributors, false)) return NextResponse.json({ ...base, cells: [], suppressed: true, notReady: false } satisfies HourlyResponse, { headers });
  const res = await loadHourly(admin, { from, to, emails, kinds });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: 500 });
  return NextResponse.json({ ...base, cells: res.cells, suppressed: false, notReady: res.notReady } satisfies HourlyResponse, { headers });
}
