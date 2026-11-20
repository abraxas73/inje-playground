import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/surveys/login-prompt — 로그인 팝업으로 띄울, 내가 아직 참여하지 않은 설문 하나(없으면 null). 웹·데스크톱 앱 공용 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ survey: null }, { status: 401 });
  const { data, error } = await supabase.rpc("pending_login_survey");
  if (error) {
    console.error("[survey login-prompt]", error.message);
    return NextResponse.json({ survey: null }); // 팝업은 부가 기능 — 실패해도 화면을 막지 않는다
  }
  const row = (data as { slug: string; title: string }[] | null)?.[0];
  return NextResponse.json({ survey: row ? { slug: row.slug, title: row.title } : null });
}
