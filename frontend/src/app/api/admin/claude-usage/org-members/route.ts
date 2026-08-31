import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";

export const runtime = "nodejs";

/**
 * Claude 조직별 멤버·초대 상태(claude_org_members).
 * GET  ?org=all|<id>&status=all|active|pending — 관리자 세션. 사내 조직도(company_directory)를 이메일로 조인해 이름/조직/팀을 붙인다.
 * POST { org_id, members: [{ email, name?, role?, seat_tier?, status }] } — 수집 토큰 또는 관리자 세션.
 *      해당 조직의 기존 행을 지우고 새로 넣는다(조직 단위 스냅샷 교체). status는 active|pending만 허용.
 */

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const org = sp.get("org") ?? "all";
  const status = sp.get("status") ?? "all";

  let q = admin.from("claude_org_members").select("*").order("status", { ascending: false }).order("email").limit(2000);
  if (org !== "all") q = q.eq("org_id", org);
  if (status === "active" || status === "pending") q = q.eq("status", status);

  const [rowsRes, directory] = await Promise.all([
    q,
    admin.from("company_directory").select("email, name, team, headquarters, division").eq("active", true).limit(1000),
  ]);
  if (rowsRes.error) return NextResponse.json({ error: rowsRes.error.message }, { status: 500 });

  const dirByEmail = new Map(
    ((directory.error ? [] : directory.data ?? []) as { email: string; name: string | null; team: string | null; headquarters: string | null; division: string | null }[])
      .map((d) => [d.email.toLowerCase(), d])
  );
  const rows = (rowsRes.data ?? []).map((r) => {
    const d = dirByEmail.get(String(r.email).toLowerCase());
    return { ...r, employee_name: d?.name ?? null, team: d?.team ?? null, headquarters: d?.headquarters ?? null, division: d?.division ?? null };
  });

  // 조직별 마지막 수집 시각
  const lastByOrg: Record<string, string> = {};
  for (const r of rows) {
    const cur = lastByOrg[r.org_id as string];
    if (!cur || (r.synced_at as string) > cur) lastByOrg[r.org_id as string] = r.synced_at as string;
  }
  return NextResponse.json({ rows, lastByOrg });
}

export async function POST(request: NextRequest) {
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const body = (await request.json().catch(() => null)) as { org_id?: unknown; members?: unknown } | null;
  const orgId = typeof body?.org_id === "string" ? body.org_id.trim().toLowerCase() : "";
  if (!orgId || !Array.isArray(body?.members)) {
    return NextResponse.json({ error: "org_id와 members 배열이 필요합니다." }, { status: 400 });
  }
  const seen = new Set<string>();
  const rows: { org_id: string; email: string; name: string | null; role: string | null; seat_tier: string | null; status: string; synced_at: string }[] = [];
  const now = new Date().toISOString();
  let skipped = 0;
  for (const m of body.members as Record<string, unknown>[]) {
    const email = typeof m?.email === "string" ? m.email.trim().toLowerCase() : "";
    const status = m?.status === "pending" ? "pending" : m?.status === "active" ? "active" : null;
    if (!email || !email.includes("@") || !status || seen.has(email)) {
      skipped++;
      continue;
    }
    seen.add(email);
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
    rows.push({ org_id: orgId, email, name: s(m.name), role: s(m.role), seat_tier: s(m.seat_tier), status, synced_at: now });
  }
  if (rows.length === 0) return NextResponse.json({ error: "유효한 멤버가 없습니다." }, { status: 400 });

  // 조직 자동 등록(처음 보는 org_id면) 후 스냅샷 교체
  await admin.from("claude_orgs").upsert({ id: orgId, name: orgId.slice(0, 8) }, { onConflict: "id", ignoreDuplicates: true });
  const del = await admin.from("claude_org_members").delete().eq("org_id", orgId).select("email");
  if (del.error) return NextResponse.json({ error: `delete: ${del.error.message}` }, { status: 500 });
  const ins = await admin.from("claude_org_members").insert(rows);
  if (ins.error) return NextResponse.json({ error: `insert: ${ins.error.message}` }, { status: 500 });

  const counts = { active: rows.filter((r) => r.status === "active").length, pending: rows.filter((r) => r.status === "pending").length };
  return NextResponse.json({ ok: true, org_id: orgId, replaced: del.data?.length ?? 0, inserted: rows.length, skipped, ...counts, synced_at: now });
}
