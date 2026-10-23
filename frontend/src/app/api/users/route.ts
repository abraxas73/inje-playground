import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import { adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { selectAll } from "@/lib/work-metrics/common";
import { installsFromRows } from "@/lib/desktop/presence";
import { listTestAccounts } from "@/lib/auth/test-account-admin";

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

  // 사내 조직도 조인(관리자 세션은 RLS로 읽기 가능) — 실패해도 목록은 내려준다
  const { data: dir } = await supabase
    .from("company_directory")
    .select("email, division, headquarters, team, duty, position")
    .eq("active", true);
  const dirMap = new Map((dir ?? []).map((d) => [String(d.email).toLowerCase(), d]));

  // 앱 설치 현황: 앱 로그인이 login_history에 남긴 User-Agent에서 사용자별·플랫폼별 마지막 로그인(버전·빌드·시각).
  // login_history는 service_role로 읽는다(홈 설치 안내 카드와 같은 출처). 실패해도 목록은 내려준다.
  const svc = adminClientOr500();
  const logins = svc.ok
    ? await selectAll<{ user_id: string; user_agent: string | null; logged_in_at: string }>(() =>
        svc.admin.from("login_history").select("user_id, user_agent, logged_in_at", { count: "exact" })
          .like("user_agent", "InnogridApp/%").order("logged_in_at", { ascending: false }).order("id"))
    : { data: null };
  const installs = installsFromRows(logins.data ?? []);
  // 테스트 계정(이메일 로그인) 배지용 — auth.users app_metadata라 service role로. 실패해도 목록은 내려준다
  const testIds = new Set(svc.ok ? (await listTestAccounts(svc.admin).catch(() => [])).map((a) => a.id) : []);

  // Merge
  const users = (profiles || []).map((p) => ({
    ...p,
    settings: settingsMap[p.user_id] || {},
    directory: dirMap.get(String(p.email ?? "").toLowerCase()) ?? null,
    installs: installs[p.user_id] ?? {},
    test_account: testIds.has(p.user_id),
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

  const { data: target } = await supabase.from("user_profiles").select("email, role").eq("user_id", userId).maybeSingle();

  const { error } = await supabase
    .from("user_profiles")
    .update({ role, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAudit(supabase, request, {
    userId: user.id, userEmail: user.email ?? null,
    action: "사용자 권한 변경", category: "users",
    detail: { targetEmail: target?.email ?? userId, from: target?.role ?? null, to: role },
  });

  return NextResponse.json({ success: true });
}
