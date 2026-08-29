import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset, summarize } from "@/lib/claude-usage/aggregate";
import type { ClaudeOrg, DailyRow, ModelRow } from "@/types/claude-usage";

const MAX_DAYS = 366;

/** PostgREST 기본 max-rows(1000)에 걸리지 않도록 range()로 전체 페이지를 모아 온다. 결정적 정렬 필수. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** GET /api/admin/claude-usage/summary?from&to&org — Claude Code(OTel) 요약 */
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
  if (from > to) return NextResponse.json({ error: "from이 to보다 늦습니다." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > MAX_DAYS) {
    return NextResponse.json({ error: `기간은 최대 ${MAX_DAYS}일입니다.` }, { status: 400 });
  }
  const org = sp.get("org");

  try {
    const [dailyRows, modelRows, orgs, imports] = await Promise.all([
      fetchAll<DailyRow>((a, b) => {
        let q = admin.from("claude_code_daily").select("*").gte("day", from).lte("day", to).order("day").order("user_email");
        if (org && org !== "all") q = q.eq("org_id", org);
        return q.range(a, b);
      }),
      fetchAll<ModelRow>((a, b) => {
        let q = admin.from("claude_code_daily_model").select("*").gte("day", from).lte("day", to).order("day").order("user_email").order("model");
        if (org && org !== "all") q = q.eq("org_id", org);
        return q.range(a, b);
      }),
      admin.from("claude_orgs").select("id, name, seats_total, sort_order").order("sort_order").order("name"),
      admin.from("claude_csv_imports").select("id, org_id, period_end").order("period_end", { ascending: false }).order("created_at", { ascending: false }),
    ]);
    const err = orgs.error ?? imports.error;
    if (err) return NextResponse.json({ error: err.message }, { status: 500 });

    // 조직별 최신 import 1개씩 → 이름/티어 조인용
    const latestByOrg = new Map<string, string>();
    for (const i of imports.data ?? []) if (!latestByOrg.has(i.org_id)) latestByOrg.set(i.org_id, i.id);
    const importIds = [...latestByOrg.values()];
    const members = importIds.length
      ? await admin.from("claude_member_activity").select("email, name, seat_tier").in("import_id", importIds)
      : { data: [] as { email: string; name: string; seat_tier: string }[], error: null };
    if (members.error) return NextResponse.json({ error: members.error.message }, { status: 500 });
    // 사내 조직도 명부(재직자) — 소속 컬럼용. 테이블이 없거나 실패해도 요약은 내려준다.
    const directory = await admin.from("company_directory").select("email, name, team, headquarters, division").eq("active", true).limit(1000);

    const summary = summarize({
      rows: dailyRows.map((r) => numify(r as unknown as Record<string, unknown>)) as unknown as DailyRow[],
      models: modelRows.map((r) => numify(r as unknown as Record<string, unknown>)) as unknown as ModelRow[],
      orgs: (orgs.data ?? []) as ClaudeOrg[],
      members: (members.data ?? []) as { email: string; name: string; seat_tier: string }[],
      directory: directory.error ? [] : ((directory.data ?? []) as { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null }[]),
      from,
      to,
    });
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
