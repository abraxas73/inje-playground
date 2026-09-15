import { after, NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
import { masterFilters } from "@/lib/marketing/search";
import { runEmailWorker } from "@/lib/marketing/email/worker";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  try {
    const { db, reviewer } = await marketingAuth(); const page = Math.max(1, Math.min(100000, Number(req.nextUrl.searchParams.get("page")) || 1));
    const r = await db.from("marketing_email_runs").select("id,scope,filters,actor_name,status,total,processed,created_at,finished_at", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page - 1) * 25, page * 25 - 1); dbCheck(r.error);
    return response({ rows: r.data, total: r.count, editable: reviewer });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json(); const f = masterFilters(new URLSearchParams(b.filters ?? {}));
    const r = await db.rpc("marketing_email_create", { p_key: b.requestKey, p_scope: b.scope, p_filters: { q: f.p_q, category: f.p_category, department: f.p_department, issues: f.p_issues }, p_ids: b.ids ?? [] }); dbCheck(r.error);
    after(async () => { try { await runEmailWorker(r.data); } catch { console.error("Marketing email worker interrupted; durable queue will resume."); } });
    return response({ id: r.data });
  } catch (e) { return failure(e); }
}
