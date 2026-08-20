import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { Member } from "@/lib/members/types";

/**
 * GET /api/members/users — 앱 사용자 명단(user_profiles, guest 제외)을 Member[]로 반환.
 * 멤버 소스 provider "users"용. 로그인한 적 있는 구성원만 포함되며, 역할은 관리자 > 사용자 관리에서 관리한다.
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("user_profiles")
    .select("user_id, email, display_name, role")
    .neq("role", "guest");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const members: Member[] = [];
  for (const row of data ?? []) {
    const email = typeof row.email === "string" ? row.email.trim() : "";
    if (!row.user_id || !email) continue;
    const display = typeof row.display_name === "string" ? row.display_name.trim() : "";
    members.push({ id: row.user_id, name: display || email.split("@")[0], email });
  }
  members.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return NextResponse.json({ members, source: "users" });
}
