import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { presenceFromRows } from "@/lib/desktop/presence";

/**
 * GET /api/desktop/presence — 내 계정으로 데스크톱 앱(macOS·Windows)에 로그인한 가장 최근 시각.
 * 앱 로그인(POST /api/mobile/login)이 login_history에 남긴 User-Agent로 판단한다. 홈 설치 안내 카드가 쓴다.
 */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data, error } = await r.admin.from("login_history").select("user_agent, logged_in_at")
    .eq("user_id", r.userId).like("user_agent", "InnogridApp/%").order("logged_in_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "앱 로그인 이력을 불러오지 못했습니다." }, { status: 503 });
  return NextResponse.json(presenceFromRows(data ?? []), { headers: { "Cache-Control": "no-store" } });
}
