import { after, NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
import { masterFilters } from "@/lib/marketing/search";
export const maxDuration = 300;
export async function GET(req: NextRequest) {
  try {
    const { db } = await marketingAuth(); const page = Math.max(1, Number(req.nextUrl.searchParams.get("page")) || 1);
    const result = await db.from("marketing_validation_runs").select("id,actor_name,scope,filters,rules,trial,status,total,processed,created_at,finished_at,last_error,attempt", { count: "exact" }).order("created_at", { ascending: false }).order("id").range((page-1)*25,page*25-1);
    dbCheck(result.error); return response({ rows: result.data, total: result.count });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json();
    const filters = masterFilters(new URLSearchParams(b.filters ?? {}));
    const result = await db.rpc("marketing_create_validation", { p_request_key: b.requestKey, p_scope: b.scope, p_filters: { q: filters.p_q, category: filters.p_category, department: filters.p_department, issues: filters.p_issues, sort: filters.p_sort, direction: filters.p_direction }, p_ids: b.ids ?? [], p_rules: b.rules ?? [], p_trial: b.trialId ?? null, p_trial_revision: b.trialRevision ?? null });
    dbCheck(result.error);
    // Best-effort fast start. PostgreSQL cron recovers queued work independently.
    after(async () => { await db.rpc("marketing_validation_action", { p_id: result.data, p_action: "kick" }); });
    return response({ id: result.data });
  } catch (e) { return failure(e); }
}
