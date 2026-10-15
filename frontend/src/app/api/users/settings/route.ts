import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";

/**
 * 범용 PUT으로 쓸 수 있는 개인 설정 키.
 *
 * 값에 **검증이 필요한 키는 여기에 두지 않는다** — 전용 라우트만 쓴다:
 * - `teams_notify_webhook_url` → `PUT /api/users/notify-channel`(https·공개 호스트 검사)
 * - `rfp_sharepoint_folder` → `PUT /api/users/sharepoint-folder`(Graph로 폴더 해석)
 * 화이트리스트가 없으면 그 검증을 이 라우트로 우회할 수 있다(서버가 임의 주소로 POST → SSRF).
 */
const ALLOWED_USER_SETTING_KEYS = new Set([
  "dooray_token",
  "dooray_project_id",
  "dooray_project_name",
  "dooray_member_id",
  "dooray_member_name",
  "innobot_button", // 앱의 떠 있는 이노봇 버튼 표시(on|off, 빈 값 = on) — 계정 단위라 모든 기기의 앱에 적용
]);
/** 값이 정해진 키 — 허용 값 밖은 400 */
const ENUM_VALUES: Record<string, readonly string[]> = { innobot_button: ["on", "off", ""] };

/** GET /api/users/settings[?key=] — 현재 사용자 개인 설정 조회. key를 주면 그 키만(앱이 토큰류 설정을 함께 받지 않도록). */
export async function GET(request?: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const only = request?.nextUrl.searchParams.get("key") ?? null;
  let query = supabase.from("user_settings").select("key, value").eq("user_id", user.id);
  if (only) query = query.eq("key", only);
  const { data } = await query;

  const settings: Record<string, string> = {};
  for (const row of data ?? []) {
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

/** PUT /api/users/settings — 개인 설정 저장 */
export async function PUT(request: NextRequest) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key || typeof key !== "string") {
    return NextResponse.json({ error: "key가 필요합니다." }, { status: 400 });
  }
  if (!ALLOWED_USER_SETTING_KEYS.has(key)) {
    return NextResponse.json({ error: "이 설정은 전용 화면에서 저장하세요." }, { status: 400 });
  }
  if (typeof value !== "string" && value !== undefined && value !== null) {
    return NextResponse.json({ error: "value는 문자열이어야 합니다." }, { status: 400 });
  }
  if (ENUM_VALUES[key] && !ENUM_VALUES[key].includes(typeof value === "string" ? value : "")) {
    return NextResponse.json({ error: `${key}는 ${ENUM_VALUES[key].filter(Boolean).join("·")} 중 하나입니다.` }, { status: 400 });
  }
  if (typeof value === "string" && value.length > 2000) {
    return NextResponse.json({ error: "value가 너무 깁니다(2000자 이하)." }, { status: 400 });
  }

  const { error } = await supabase.from("user_settings").upsert(
    {
      user_id: user.id,
      key,
      value: value ?? "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
