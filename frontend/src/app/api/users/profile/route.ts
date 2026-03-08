import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/** GET /api/users/profile — 현재 사용자 프로필 조회 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data } = await supabase
    .from("user_roles")
    .select("display_name, role")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({
    email: user.email,
    display_name: data?.display_name ?? user.user_metadata?.full_name ?? null,
    avatar_url: user.user_metadata?.avatar_url ?? null,
    role: data?.role ?? "user",
  });
}

/** PATCH /api/users/profile — 이름 수정 */
export async function PATCH(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const displayName = (body.display_name ?? "").trim();

  if (!displayName) {
    return NextResponse.json(
      { error: "이름을 입력해주세요." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("user_roles")
    .update({ display_name: displayName })
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "이름 변경에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, display_name: displayName });
}
