import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { logLogin } from "@/lib/audit";

/** POST /api/users/login-history — 로그인 기록 저장 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await logLogin(supabase, request, { userId: user.id, userEmail: user.email ?? null });
  return NextResponse.json({ ok: true });
}
