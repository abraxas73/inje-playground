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

export async function POST(req: Request) {
  const { oAuthToken, signKey, email } = (await req
    .json()
    .catch(() => ({}))) as GwAuthRequestBody;
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

  // 유효 세션 확인됨 → 이메일로 Supabase 세션 발급. 이름은 이메일 로컬파트.
  const name = email.split("@")[0];
  const admin = createAdminClient();
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
