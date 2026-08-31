import { NextResponse } from "next/server";
import { resolveUsageScope } from "@/lib/usage-scope";
import { numify } from "@/lib/claude-usage/require-admin";

/**
 * GET /api/usage/chat — 개인/팀장용 채팅·Cowork 활동(월간 CSV 최신 스냅샷, 어드민 아님).
 * 조직별 최신 import에서 허용 범위 이메일 행만 내려준다.
 */
export async function GET() {
  const r = await resolveUsageScope();
  if (!r.ok) return r.response;
  const { scope, admin } = r;

  const imports = await admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, created_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });
  const latest = new Map<string, { id: string; period_start: string; period_end: string }>();
  for (const i of imports.data ?? []) if (!latest.has(i.org_id)) latest.set(i.org_id, i);
  const ids = [...latest.values()].map((i) => i.id);
  if (ids.length === 0) return NextResponse.json({ period: null, rows: [], scope: { scope: scope.scope, scopeLabel: scope.scopeLabel } });

  const emails = scope.members.map((m) => m.email);
  const rows = await admin.from("claude_member_activity").select("*").in("import_id", ids).in("email", emails).limit(2000);
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });

  const periods = [...latest.values()];
  const period = { from: periods.map((p) => p.period_start).sort()[0], to: periods.map((p) => p.period_end).sort().at(-1)! };
  const nameOf = new Map(scope.members.map((m) => [m.email, m.name]));

  return NextResponse.json({
    period,
    scope: { scope: scope.scope, scopeLabel: scope.scopeLabel },
    rows: (rows.data ?? []).map((raw) => {
      const row = numify(raw as Record<string, unknown>) as Record<string, unknown>;
      return { ...row, employee_name: nameOf.get(String(row.email).toLowerCase()) ?? null };
    }),
  });
}
