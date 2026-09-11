import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDigest } from "./digest";

export async function loadDigest(admin: SupabaseClient, from: string, to: string, appUrl: string) {
  const [articles, sync] = await Promise.all([
    admin.from("yonhap_notices").select("source_id,category,title,summary,source_url,published_at", { count: "exact" })
      .gte("created_at", from).lt("created_at", to).order("published_at", { ascending: false }).order("source_id", { ascending: false }).limit(100),
    admin.from("yonhap_notice_sync_runs").select("finished_at").eq("status", "success").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (articles.error || sync.error) throw new Error("메일 소식 조회 실패");
  const count = articles.count ?? 0;
  return { digest: buildDigest(articles.data ?? [], count, to, sync.data?.finished_at ?? null, appUrl, from), count };
}

export function digestAppUrl() {
  const url = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (!url || new URL(url).protocol !== "https:") throw new Error("메일 앱 주소 설정이 필요합니다.");
  return url;
}
