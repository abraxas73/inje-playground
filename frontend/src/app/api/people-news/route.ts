import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { PAGE_SIZE, parseNoticeQuery } from "@/lib/people-news/query";

export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (profile?.role !== "user" && profile?.role !== "admin") {
    return NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 });
  }
  let params: ReturnType<typeof parseNoticeQuery>;
  try {
    params = parseNoticeQuery(request.nextUrl.searchParams);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "조회 조건이 올바르지 않습니다." }, { status: 400 });
  }
  try {
    let query = supabase.from("yonhap_notices")
      .select("source_id,category,title,summary,source_url,published_at", { count: "exact" })
      .order("published_at", { ascending: false })
      .order("source_id", { ascending: false });
    if (params.category !== "all") query = query.eq("category", params.category);
    if (params.search) query = query.ilike("title", params.search);
    if (params.fromIso) query = query.gte("published_at", params.fromIso);
    if (params.toIso) query = query.lt("published_at", params.toIso);
    const [notices, success, latest] = await Promise.all([
      query.range(params.offset, params.offset + PAGE_SIZE - 1),
      supabase.from("yonhap_notice_sync_runs").select("finished_at").eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("yonhap_notice_sync_runs").select("started_at,finished_at,status,item_count").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (notices.error || success.error || latest.error) {
      throw new Error(notices.error?.message ?? success.error?.message ?? latest.error?.message);
    }
    return NextResponse.json({
      notices: notices.data ?? [], total: notices.count ?? 0,
      page: params.page, pageSize: PAGE_SIZE,
      lastSyncedAt: success.data?.finished_at ?? null, latestSync: latest.data ?? null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[people-news] 조회 실패", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "인사·부고를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 500 });
  }
}
