import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import type { DirectoryPerson, DirectoryResponse, DirectorySync } from "@/types/directory";

/**
 * GET /api/admin/directory?q=&division=&active=true|false|all
 * 사내 조직도 명부(company_directory) + 마지막 동기화. 관리자 세션 필수.
 * 명부는 수백 명 규모라 한 번에 읽는다(PostgREST 기본 max-rows 1000 이내). 1000명을 넘기면 range 페이징으로 전환.
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim().toLowerCase();
  const division = (sp.get("division") ?? "").trim();
  const active = sp.get("active") ?? "true";

  let query = admin
    .from("company_directory")
    .select("*")
    .order("division")
    .order("headquarters")
    .order("team")
    .order("name")
    .limit(1000);
  if (active === "true") query = query.eq("active", true);
  else if (active === "false") query = query.eq("active", false);
  if (division) query = query.eq("division", division);

  const [rowsRes, syncRes, activeCount, inactiveCount] = await Promise.all([
    query,
    admin.from("company_directory_sync").select("*").order("synced_at", { ascending: false }).limit(1),
    admin.from("company_directory").select("*", { count: "exact", head: true }).eq("active", true),
    admin.from("company_directory").select("*", { count: "exact", head: true }).eq("active", false),
  ]);
  const err = rowsRes.error ?? syncRes.error ?? activeCount.error ?? inactiveCount.error;
  if (err) return NextResponse.json({ error: err.message }, { status: 500 });

  let rows = (rowsRes.data ?? []) as DirectoryPerson[];
  if (q) {
    rows = rows.filter((r) =>
      [r.name, r.email, r.login_id, r.team, r.headquarters, r.division, r.duty, r.position]
        .some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }
  const body: DirectoryResponse = {
    rows,
    lastSync: (syncRes.data?.[0] as DirectorySync | undefined) ?? null,
    counts: { active: activeCount.count ?? 0, inactive: inactiveCount.count ?? 0 },
  };
  return NextResponse.json(body);
}
