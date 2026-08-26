import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin.from("claude_orgs").select("id, name, seats_total, sort_order").order("sort_order").order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ orgs: data ?? [] });
}

/** PATCH { id, name?, seats_total?, sort_order? } */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { id?: unknown; name?: unknown; seats_total?: unknown; sort_order?: unknown } | null;
  if (!body || typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  const patch: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (body.seats_total === null || (typeof body.seats_total === "number" && Number.isInteger(body.seats_total) && body.seats_total >= 0)) patch.seats_total = body.seats_total;
  if (typeof body.sort_order === "number" && Number.isInteger(body.sort_order)) patch.sort_order = body.sort_order;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "변경할 값이 없습니다." }, { status: 400 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin.from("claude_orgs").update(patch).eq("id", body.id).select("id, name, seats_total, sort_order").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ org: data });
}
