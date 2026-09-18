import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { applyIdentityMap, loadIdentityMap } from "@/lib/claude-usage/identity-map";
import { orgCategory } from "@/lib/claude-usage/org-options";
import { selectAll } from "@/lib/work-metrics/common";
import { lastMonths, monthRange } from "@/lib/claude-cost/money";
import { summarizeMonthly } from "@/lib/claude-cost/monthly";
import { isApiCostAvailable } from "@/lib/claude-cost/anthropic-cost-report";
import { INVOICE_COLUMNS } from "@/lib/claude-cost/invoice-ingest";
import type { ClaudeOrg, DailyRow } from "@/types/claude-usage";
import type { ApiCostRow, InvoiceRow, MonthBasis } from "@/types/claude-cost";

/**
 * GET /api/admin/claude-cost/monthly?months=12&org=all|<id>&basis=issued|period
 * 조직은 Team 조직만(개인 조직은 인보이스가 없다). org=<id>면 그 조직 하나.
 * basis=period(서비스 기간 일할)면 기간이 조회 범위와 겹치는 인보이스까지 읽는다(연간 인보이스가 발행 월 밖의 달에도 기여).
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const sp = request.nextUrl.searchParams;
  const n = Math.min(36, Math.max(1, Number(sp.get("months") ?? 12) || 12));
  const months = lastMonths(n);
  const from = `${months[0]}-01`;
  const to = monthRange(months[months.length - 1]).to;
  const orgParam = sp.get("org") || "all";
  const basis: MonthBasis = sp.get("basis") === "period" ? "period" : "issued";

  try {
    const orgsRes = await admin.from("claude_orgs").select("id, name, seats_total, sort_order, category").order("sort_order").order("name");
    if (orgsRes.error) throw new Error(orgsRes.error.message);
    const allOrgs = (orgsRes.data ?? []) as ClaudeOrg[];
    const teamOrgs = allOrgs.filter((o) => orgCategory(o) === "team");
    const orgs = orgParam === "all" ? teamOrgs : teamOrgs.filter((o) => o.id === orgParam);
    const orgIds = orgs.map((o) => o.id);
    const orgIn = orgIds.length ? orgIds : ["__none__"];
    const apiAvailable = isApiCostAvailable();

    // 누락 판정은 기준과 무관하게 서비스 기간 커버리지라, 기간이 범위와 겹치는 장(연간 포함)은 항상 함께 읽는다
    const invQ = admin.from("claude_invoices").select(INVOICE_COLUMNS).lte("issued_on", to).or(`issued_on.gte.${from},period_end.gte.${from}`).order("issued_on");
    const [invoices, identities, apiCost, dailyRes, importsRes] = await Promise.all([
      orgParam === "all" ? invQ : invQ.eq("org_id", orgParam),
      loadIdentityMap(admin),
      apiAvailable && orgParam === "all"
        ? selectAll<ApiCostRow>(() => admin.from("claude_api_cost_daily").select("day, workspace_id, description, cost_type, model, amount_cents, currency", { count: "exact" }).gte("day", from).lte("day", to).order("day").order("workspace_id").order("description"))
        : Promise.resolve({ data: null as ApiCostRow[] | null, error: null }),
      selectAll<DailyRow>(() => admin.from("claude_code_daily").select("*", { count: "exact" }).in("org_id", orgIn).gte("day", from).lte("day", to).order("day").order("user_email")),
      admin.from("claude_csv_imports").select("id, org_id, period_end").in("org_id", orgIn).gte("period_end", from).lte("period_end", to),
    ]);
    if (invoices.error) throw new Error(invoices.error.message);
    if (apiCost.error) throw new Error(apiCost.error.message);
    if (dailyRes.error) throw new Error(dailyRes.error.message);
    if (importsRes.error) throw new Error(importsRes.error.message);

    // CSV 활성 멤버: 그 회차에 채팅·Code·Cowork 중 하나라도 있는 멤버 수
    const imports = (importsRes.data ?? []) as { id: string; org_id: string; period_end: string }[];
    const csv: { org_id: string; period_end: string; active: number }[] = [];
    if (imports.length) {
      const members = await selectAll<{ import_id: string; chats: number; code_sessions: number; cowork_sessions: number }>(() =>
        admin.from("claude_member_activity").select("import_id, chats, code_sessions, cowork_sessions", { count: "exact" }).in("import_id", imports.map((i) => i.id)).order("import_id").order("email"),
      );
      if (members.error) throw new Error(members.error.message);
      const active = new Map<string, number>();
      for (const m of members.data) if (Number(m.chats) + Number(m.code_sessions) + Number(m.cowork_sessions) > 0) active.set(m.import_id, (active.get(m.import_id) ?? 0) + 1);
      for (const i of imports) csv.push({ org_id: i.org_id, period_end: i.period_end, active: active.get(i.id) ?? 0 });
    }

    // PostgREST numeric은 문자열로 올 수 있어 집계에 쓰는 네 필드만 숫자화한다
    const daily = applyIdentityMap((dailyRes.data ?? []).map((r) => ({ ...r, sessions: Number(r.sessions), prompts: Number(r.prompts), prompts_auto: Number(r.prompts_auto), cost_usd: Number(r.cost_usd) })), identities);
    const result = summarizeMonthly({
      months,
      orgs,
      invoices: (invoices.data ?? []) as unknown as InvoiceRow[],
      apiCost: apiAvailable ? (apiCost.data ?? []).map((r) => ({ ...r, amount_cents: String(r.amount_cents) })) : null,
      daily,
      csv,
    }, { basis });
    return NextResponse.json({ months: result, basis, apiCostAvailable: apiAvailable, orgs: teamOrgs });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
