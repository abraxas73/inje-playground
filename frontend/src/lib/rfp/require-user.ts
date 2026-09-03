import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";

export type RfpCaller = { userId: string; role: "user" | "admin"; admin: SupabaseClient };

/** 세션 사용자가 user 이상인지 확인하고 service role 클라이언트를 함께 준다. 메시지 형식은 requireAdmin과 같다. */
export async function requireUser(): Promise<({ ok: true } & RfpCaller) | { ok: false; response: NextResponse }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  const role = profile?.role;
  if (role !== "user" && role !== "admin") {
    return { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) };
  }
  const a = adminClientOr500();
  if (!a.ok) return a;
  return { ok: true, userId: user.id, role, admin: a.admin };
}
