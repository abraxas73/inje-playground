import { NextRequest, NextResponse } from "next/server";
import { adminClientOr500, requireAdmin } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";
import { kstDay } from "@/lib/chat/usage";
import { aggregateUsage, type UsageRow } from "@/lib/chat/usage-report";

export const runtime = "nodejs";
/** GET /api/admin/assistant-usage?days= — 이노봇 사용량(사용자·팀). 대화 본문은 읽지 않는다. */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const a = adminClientOr500();
  if (!a.ok) return a.response;
  const days = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("days"))) ? Number(new URL(request.url).searchParams.get("days")) : 30;
  const from = kstDay(new Date(Date.now() - (days - 1) * 24 * 3600_000));
  const rows = await selectAll<UsageRow>(() => a.admin.from("assistant_usage").select("user_id,day,turns,input_tokens,output_tokens,model_turns,masked", { count: "exact" }).gte("day", from).order("day"));
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  const ids = [...new Set(rows.data.map((r) => r.user_id))];
  const { data: profiles } = ids.length ? await a.admin.from("user_profiles").select("user_id,display_name,email").in("user_id", ids) : { data: [] };
  const people = new Map(((profiles ?? []) as Array<{ user_id: string; display_name: string | null; email: string | null }>).map((p) => [p.user_id, { name: p.display_name ?? "", email: (p.email ?? "").toLowerCase() }]));
  const emails = [...people.values()].map((p) => p.email).filter(Boolean);
  const { data: dir } = emails.length ? await a.admin.from("company_directory").select("email,team").in("email", emails) : { data: [] };
  const teams = new Map(((dir ?? []) as Array<{ email: string; team: string | null }>).map((d) => [d.email.toLowerCase(), d.team ?? ""]));
  return NextResponse.json({ from, ...aggregateUsage(rows.data, people, teams) }, { headers: { "Cache-Control": "no-store" } });
}
