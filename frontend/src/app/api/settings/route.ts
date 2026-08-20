import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import { ADMIN_ONLY_SETTING_KEYS } from "@/lib/providers";

async function getCallerRole(supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: "guest" as const };
  const { data } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  return { user, role: (data?.role ?? "user") as string };
}

/** GET /api/settings — 전역 설정. 웹훅 URL 등 admin 전용 키는 admin에게만 반환 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { role } = await getCallerRole(supabase);

  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data) {
    if (role !== "admin" && ADMIN_ONLY_SETTING_KEYS.has(row.key)) continue;
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

/** PUT /api/settings — 전역 설정 저장 (admin only) */
export async function PUT(request: Request) {
  const supabase = await createServerSupabase();
  const { user, role } = await getCallerRole(supabase);
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  if (role !== "admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
