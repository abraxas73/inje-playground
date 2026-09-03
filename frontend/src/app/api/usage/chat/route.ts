import { NextRequest, NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { numify } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";

export const runtime = "nodejs";

/**
 * GET /api/usage/chat?periodEnd=latest|YYYY-MM-DD — 개인/조직장용 채팅·Cowork 활동(월간 CSV 스냅샷, 어드민 아님).
 * - periodEnd(YYYY-MM-DD): 데이터 기간 종료일이 그 날짜인 CSV 중 조직별 최신 업로드. 없으면 조직별 최신.
 * - 허용 범위(resolveUsageScope) 이메일 행만 내려준다. 응답 imports는 기간 선택 옵션용(조직·기간만, 파일명 등 제외).
 * - 각 행에 같은 데이터 기간의 Claude Code 프롬프트 수(OTel, 사람/자동)를 붙인다 — 어드민 멤버 활동 표와 같은 컬럼.
 */
export async function GET(request: NextRequest) {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;
  const scopeOut = { scope: scope.scope, scopeLabel: scope.scopeLabel };

  const sp = request.nextUrl.searchParams;
  const periodEnd = /^\d{4}-\d{2}-\d{2}$/.test(sp.get("periodEnd") ?? "") ? (sp.get("periodEnd") as string) : null;

  type Imp = { id: string; org_id: string; period_start: string; period_end: string; created_at: string };
  const imports = await selectAll<Imp>(() =>
    admin.from("claude_csv_imports").select("id, org_id, period_start, period_end, created_at", { count: "exact" }).order("period_end", { ascending: false }).order("created_at", { ascending: false }).order("id")
  );
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });
  const all = imports.data;
  const options = all.map((i) => ({ org_id: i.org_id, period_start: i.period_start, period_end: i.period_end }));

  // period_end desc, created_at desc 정렬이라 조직별 첫 항목이 최신 업로드
  const pool = periodEnd ? all.filter((i) => i.period_end === periodEnd) : all;
  const latest = new Map<string, Imp>();
  for (const i of pool) if (!latest.has(i.org_id)) latest.set(i.org_id, i);
  const selected = [...latest.values()];
  const ids = selected.map((i) => i.id);
  if (ids.length === 0) return NextResponse.json({ period: null, collected_at: null, imports: options, rows: [], scope: scopeOut });

  const period = { from: selected.map((p) => p.period_start).sort()[0], to: selected.map((p) => p.period_end).sort().at(-1)! };
  const collectedAt = selected.map((p) => p.created_at).sort().at(-1) ?? null;
  const emails = scope.members.map((m) => m.email);

  const [rows, codeRes] = await Promise.all([
    selectAll<Record<string, unknown>>(() =>
      admin.from("claude_member_activity").select("*", { count: "exact" }).in("import_id", ids).in("email", emails).order("import_id").order("email")
    ),
    selectAll<{ user_email: string; prompts: number | string; prompts_auto: number | string }>(() =>
      admin.from("claude_code_daily").select("user_email, prompts, prompts_auto", { count: "exact" }).in("user_email", emails).gte("day", period.from).lte("day", period.to).order("day").order("org_id").order("user_email")
    ),
  ]);
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });

  // Claude Code 프롬프트(OTel) — 데이터 기간, 조직 무관 이메일 합. 실패해도 표는 내려준다
  const codePrompts = new Map<string, { human: number; auto: number }>();
  for (const c of codeRes.data ?? []) {
    const k = c.user_email.toLowerCase();
    const v = codePrompts.get(k) ?? { human: 0, auto: 0 };
    v.human += Number(c.prompts) - Number(c.prompts_auto);
    v.auto += Number(c.prompts_auto);
    codePrompts.set(k, v);
  }
  const memberOf = new Map(scope.members.map((m) => [m.email, m]));

  return NextResponse.json({
    period,
    collected_at: collectedAt,
    imports: options,
    scope: scopeOut,
    rows: rows.data.map((raw) => {
      const row = numify(raw) as Record<string, unknown>;
      const email = String(row.email ?? "").toLowerCase();
      const m = memberOf.get(email);
      return {
        ...row,
        employee_name: m?.name ?? null,
        team: m?.team ?? null,
        parent_unit: m?.parent_unit ?? null,
        headquarters: m?.headquarters ?? null,
        division: m?.division ?? null,
        code_prompts: codePrompts.get(email)?.human ?? 0,
        code_prompts_auto: codePrompts.get(email)?.auto ?? 0,
      };
    }),
  });
}
