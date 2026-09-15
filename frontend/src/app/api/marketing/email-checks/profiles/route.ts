import { NextRequest } from "next/server";
import { dbCheck, failure, marketingAuth, MarketingError, response } from "@/lib/marketing/server";
import { normalizeDomain, publicMail, websiteUrl } from "@/lib/marketing/email/normalize";
export async function GET(req: NextRequest) {
  try {
    const { db, reviewer } = await marketingAuth(); const id = req.nextUrl.searchParams.get("id");
    if (!id) throw new MarketingError("회사 ID가 필요합니다.");
    const [org, profile, history] = await Promise.all([
      db.from("marketing_organizations").select("id,name,version").eq("id", id).single(),
      db.from("marketing_email_profiles").select("*").eq("organization_id", id).maybeSingle(),
      db.from("marketing_email_profile_history").select("version,after_data,actor_name,reason,created_at").eq("organization_id", id).order("version", { ascending: false }).limit(20),
    ]); [org, profile, history].forEach(r => dbCheck(r.error));
    return response({ organization: org.data, profile: profile.data, history: history.data, editable: reviewer });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json();
    if (typeof b.website !== "string" || !Array.isArray(b.domains) || b.domains.length > 20 || b.domains.some((x: unknown) => typeof x !== "string")) throw new MarketingError("홈페이지와 이메일 도메인을 확인하세요.");
    const website = b.website.trim() ? websiteUrl(b.website).href : ""; const domains = [...new Set<string>(b.domains.map(normalizeDomain))];
    if (domains.some(publicMail)) throw new MarketingError("공용 메일 서비스는 회사 전용 도메인으로 등록할 수 없습니다.");
    const r = await db.rpc("marketing_email_profile_save", { p_id: b.id, p_version: b.version, p_org_version: b.organizationVersion, p_website: website, p_domains: domains, p_reason: b.reason }); dbCheck(r.error); return response(r.data);
  } catch (e) { return failure(e); }
}
