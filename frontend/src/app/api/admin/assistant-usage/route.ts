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
  // 사용자·조직도는 수백 명이라 전부 읽어 메모리에서 조인한다(.in() 목록이 길면 URL 한도를 넘는다)
  const [profiles, dir] = await Promise.all([
    selectAll<{ user_id: string; display_name: string | null; email: string | null }>(() => a.admin.from("user_profiles").select("user_id,display_name,email", { count: "exact" }).order("user_id")),
    selectAll<{ email: string; team: string | null }>(() => a.admin.from("company_directory").select("email,team", { count: "exact" }).eq("active", true).order("email")),
  ]);
  if (profiles.error || dir.error) return NextResponse.json({ error: (profiles.error ?? dir.error)!.message }, { status: 500 });
  const people = new Map(profiles.data.map((p) => [p.user_id, { name: p.display_name ?? "", email: (p.email ?? "").toLowerCase() }]));
  const teams = new Map(dir.data.map((d) => [d.email.toLowerCase(), d.team ?? ""]));
  return NextResponse.json({ from, ...aggregateUsage(rows.data, people, teams) }, { headers: { "Cache-Control": "no-store" } });
}
