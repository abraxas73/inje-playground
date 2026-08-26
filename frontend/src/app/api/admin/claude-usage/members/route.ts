import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, numify } from "@/lib/claude-usage/require-admin";

/** GET /api/admin/claude-usage/members?org=all|<id>&importId=latest|<uuid> — CSV 멤버 활동 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const sp = request.nextUrl.searchParams;
  const org = sp.get("org") ?? "all";
  const importId = sp.get("importId") ?? "latest";

  let importsQ = admin
    .from("claude_csv_imports")
    .select("id, org_id, period_start, period_end, filename, row_count, created_at")
    .order("period_end", { ascending: false })
    .order("created_at", { ascending: false });
  if (org !== "all") importsQ = importsQ.eq("org_id", org);
  const imports = await importsQ;
  if (imports.error) return NextResponse.json({ error: imports.error.message }, { status: 500 });

  let ids: string[];
  if (importId === "latest") {
    const seen = new Map<string, string>();
    for (const i of imports.data ?? []) if (!seen.has(i.org_id)) seen.set(i.org_id, i.id);
    ids = [...seen.values()];
  } else {
    ids = [importId];
  }
  const rows = ids.length
    ? await admin.from("claude_member_activity").select("*").in("import_id", ids).order("chats", { ascending: false })
    : { data: [] as Record<string, unknown>[], error: null };
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });

  return NextResponse.json({ imports: imports.data ?? [], rows: (rows.data ?? []).map((r) => numify(r as Record<string, unknown>)) });
}
