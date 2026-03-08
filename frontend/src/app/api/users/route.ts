import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/users — 사용자 목록 + 개인 설정 (admin only) */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  // Check admin
  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (caller?.role !== "admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  // Fetch profiles
  const { data: profiles, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .order("created_at", { ascending: true });

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  // Fetch all user_settings
  const { data: allSettings } = await supabase
    .from("user_settings")
    .select("user_id, key, value");

  // Group settings by user_id
  const settingsMap: Record<string, Record<string, string>> = {};
  for (const row of allSettings || []) {
    if (!settingsMap[row.user_id]) settingsMap[row.user_id] = {};
    // 토큰은 마스킹
    if (row.key === "dooray_token" && row.value) {
      settingsMap[row.user_id][row.key] = row.value.slice(0, 8) + "***";
    } else {
      settingsMap[row.user_id][row.key] = row.value;
    }
  }

  // Merge
  const users = (profiles || []).map((p) => ({
    ...p,
    settings: settingsMap[p.user_id] || {},
  }));

  return NextResponse.json({ users });
}

/** PATCH /api/users — 사용자 역할 변경 (admin only) */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();

  if (caller?.role !== "admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await request.json();
  const { userId, role } = body;

  if (!userId || !["guest", "user", "admin"].includes(role)) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  // Prevent self-demotion
  if (userId === user.id && role !== "admin") {
    return NextResponse.json({ error: "자신의 관리자 권한은 변경할 수 없습니다." }, { status: 400 });
  }

  const { error } = await supabase
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
