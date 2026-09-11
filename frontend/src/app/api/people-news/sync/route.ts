import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export const maxDuration = 60;

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (profile?.role !== "user" && profile?.role !== "admin") {
    return NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 });
  }
  // getUser() above verified this session. Edge Function independently verifies it again.
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return NextResponse.json({ error: "다시 로그인해 주세요." }, { status: 401 });
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/yonhap-notices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: "{}",
      signal: AbortSignal.timeout(50_000),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: result.error ?? "지금 가져오기에 실패했습니다." }, {
        status: response.status,
        headers: response.status === 429 ? { "Retry-After": "60" } : undefined,
      });
    }
    return NextResponse.json({ ok: true, count: result.count }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "수집 결과를 확인하지 못했습니다. 잠시 후 목록을 새로고침해 주세요." }, { status: 502 });
  }
}
