import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

export async function requireNewsUser() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, response: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const { data: profile } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  if (profile?.role !== "user" && profile?.role !== "admin") return { ok: false as const, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) };
  return { ok: true as const, supabase, user };
}
