import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const GW_BASE = process.env.GW_API_BASE ?? "https://gw.innogrid.com";
// 토큰 유효성 검증용 GW 엔드포인트: 유효 세션이면 200 + resultCode 0 을 반환함(B6에서 확인).
const VERIFY_PATH = "/gw/gw016A02";

interface GwAuthRequestBody {
  oAuthToken?: string;
  signKey?: string;
  email?: string;
}

/**
 * 킬스위치: 환경변수 GW_LOGIN_ENABLED=true 일 때만 활성. 기본은 404.
 * GW가 토큰 기반 사용자 조회 API를 제공하지 않아 email을 서버가 독립 검증할 수 없으므로,
 * 로그인 UI가 없는 동안에는 엔드포인트 자체를 닫아 내부자 사칭(비admin 계정 탈취) 표면을 제거한다.
 */
function isGwLoginEnabled(): boolean {
  return process.env.GW_LOGIN_ENABLED === "true";
}

export async function POST(req: Request) {
  if (!isGwLoginEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { oAuthToken, signKey, email: rawEmail } = (await req
    .json()
    .catch(() => ({}))) as GwAuthRequestBody;
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!oAuthToken || !signKey || !email) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (!isInnogridEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 403 });
  }

  // 토큰이 유효한 GW 세션인지 확인 (위조 토큰 차단). 유효 세션 → 200 && resultCode 0.
  const transactionId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildGwSignature({ oAuthToken, signKey, transactionId, timestamp, pathname: VERIFY_PATH });
  const gwRes = await fetch(`${GW_BASE}${VERIFY_PATH}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${oAuthToken}`,
      "transaction-id": transactionId,
      "timestamp": String(timestamp),
      "wehago-sign": signature,
      "Content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });
  if (!gwRes.ok) {
    return NextResponse.json({ error: "gw auth failed" }, { status: 401 });
  }
  const data = (await gwRes.json().catch(() => ({}))) as Record<string, unknown>;
  if (data?.resultCode !== 0) {
    return NextResponse.json({ error: "gw session invalid" }, { status: 401 });
  }

  // 유효 세션 확인됨. 완화책: GW 로그인으로는 admin 권한을 부여하지 않는다.
  // GW가 토큰 기반 사용자정보 조회 API를 제공하지 않아 서버가 이메일을 독립 검증할 수 없으므로,
  // 이메일 사칭에 의한 관리자 탈취를 구조적으로 차단한다(admin은 Google 로그인 전용).
  const admin = createAdminClient();
  const { data: existingProfile, error: profileError } = await admin
    .from("user_profiles")
    .select("role")
    .ilike("email", email)
    .maybeSingle();
  if (profileError) {
    return NextResponse.json({ error: "role check failed" }, { status: 500 });
  }
  if (existingProfile?.role === "admin") {
    return NextResponse.json({ error: "admin_gw_forbidden" }, { status: 403 });
  }

  // 이메일로 Supabase 세션 발급. 이름은 이메일 로컬파트.
  const name = email.split("@")[0];
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { data: { full_name: name } },
  });
  if (error || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: "session issue failed" }, { status: 500 });
  }

  return NextResponse.json({ token_hash: link.properties.hashed_token, email });
}
