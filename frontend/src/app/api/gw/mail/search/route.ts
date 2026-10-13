import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { callApp, parseSearch } from "@/lib/gw/mail";

export const runtime = "nodejs";
export const maxDuration = 120;
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/gw/mail/search?q=&sort=relevance — 데스크톱 앱의 기기 안 메일 색인 검색(`search_mail_index`, 앱 메일 검색과 같은 검색식). 앱 미실행이면 409 `no_app`. 검색어는 기록하지 않는다. */
export async function GET(req: Request) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return NextResponse.json({ error: "검색어가 필요합니다." }, { status: 400, headers: NO_STORE });
  const res = await callApp(r.admin, r.userId, "search_mail_index", { query: q, by_relevance: url.searchParams.get("sort") === "relevance", limit: 100 });
  if (!res.ok) {
    // 1.6.8 이하 앱에는 이 도구가 없다
    const message = res.code === "tool" && res.message.includes("모르는 도구") ? "메일 검색은 데스크톱 앱 1.6.9부터 됩니다. 앱을 업데이트한 뒤 다시 시도하세요." : res.message;
    return NextResponse.json({ error: message, code: res.code }, { status: res.code === "no_app" ? 409 : 502, headers: NO_STORE });
  }
  return NextResponse.json(parseSearch(res.data), { headers: NO_STORE });
}
