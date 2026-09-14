import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
import { masterFilters } from "@/lib/marketing/search";

export async function GET(req: NextRequest) {
  try {
    const { db, reviewer, admin } = await marketingAuth();
    const params = req.nextUrl.searchParams;
    const view = params.get("view") ?? "master";
    const page = Math.max(1, Math.min(100000, Number(params.get("page")) || 1));
    const q = (params.get("q") ?? "").trim().slice(0, 100).replace(/[,%()\\]/g, " ");
    const pageSize = 25;
    if (view === "meta") {
      const result = await db.rpc("marketing_stats"); dbCheck(result.error);
      const identity = await db.rpc("marketing_identity"); dbCheck(identity.error);
      return response({ reviewer, admin, ...result.data, identity: identity.data });
    }
    if (view === "reviewers") {
      if (!admin) return response({ rows: [] });
      const result = await db.from("marketing_reviewers").select("user_id"); dbCheck(result.error);
      return response({ rows: result.data });
    }
    if (view === "contact") {
      const id = params.get("id");
      if (!id) throw new Error("Contact ID가 필요합니다.");
      const result = await db.from("marketing_contacts").select("*,organization:marketing_organizations(*)").eq("id", id).single(); dbCheck(result.error);
      const sources = await db.from("marketing_source_rows").select("sheet,row_number,raw,batch_id").eq("contact_id", id); dbCheck(sources.error);
      const events = await db.from("marketing_review_events").select("*").or(`contact_id.eq.${result.data.id},organization_id.eq.${result.data.organization_id ?? result.data.id}`).order("created_at", { ascending: false }); dbCheck(events.error);
      return response({ contact: result.data, sources: sources.data, events: events.data });
    }
    if (view === "submission") {
      const id = params.get("id"); if (!id) throw new Error("제출 ID가 필요합니다.");
      const s = await db.from("marketing_submissions").select("*").eq("id", id).single(); dbCheck(s.error);
      const events = await db.from("marketing_review_events").select("*").eq("submission_id", id).order("created_at", { ascending: false }); dbCheck(events.error);
      const validations = await db.from("marketing_validations").select("*").eq("submission_id", id).order("created_at", { ascending: false }); dbCheck(validations.error);
      return response({ events: events.data, validations: validations.data });
    }
    if (view === "organization-conflicts") {
      const r = await db.rpc("marketing_organization_conflicts"); dbCheck(r.error); return response({ rows: r.data });
    }
    if (view === "organizations") {
      let query = db.from("marketing_organizations").select("*", { count: "exact" }).order("name").order("id");
      if (q) query = query.ilike("name", `%${q}%`);
      if (params.get("category")) query = query.eq("category", params.get("category")!);
      const result = await query.range((page - 1) * pageSize, page * pageSize - 1); dbCheck(result.error);
      const ids = (result.data ?? []).map(o => o.id);
      const counts = ids.length ? await db.rpc("marketing_org_counts", { p_ids: ids }) : { data: {}, error: null }; dbCheck(counts.error);
      return response({ rows: result.data, total: result.count, counts: counts.data, pageSize });
    }
    if (view === "history") {
      let query = db.from("marketing_review_events").select("*", { count: "exact" });
      if (q) query = query.or(`submitter.ilike.%${q}%,actor_name.ilike.%${q}%,reason.ilike.%${q}%,after_data->contact->>db_id.ilike.%${q}%`);
      if (params.get("division")) query = query.ilike("division", `%${params.get("division")!.slice(0,100)}%`);
      const result = await query.order("created_at", { ascending: false }).order("id").range((page - 1) * pageSize, page * pageSize - 1); dbCheck(result.error);
      return response({ rows: result.data, total: result.count, pageSize });
    }
    if (view === "queue") {
      let query = db.from("marketing_submissions").select("*", { count: "exact" }).order("created_at", { ascending: false }).order("id");
      query = query.eq("status", params.get("status") ?? "pending");
      if (params.get("kind")) query = query.eq("validation->>kind", params.get("kind")!);
      if (params.get("division")) query = query.ilike("division", `%${params.get("division")!.slice(0, 100)}%`);
      if (q) query = query.or(`data->>company.ilike.%${q}%,data->>name.ilike.%${q}%,data->>email.ilike.%${q}%`);
      const result = await query.range((page - 1) * pageSize, page * pageSize - 1); dbCheck(result.error);
      return response({ rows: result.data, total: result.count, pageSize, reviewer });
    }
    const result = await db.rpc("marketing_search_contacts", { ...masterFilters(params), p_offset: (page - 1) * pageSize });
    dbCheck(result.error); return response(result.data);
  } catch (e) { return failure(e); }
}
