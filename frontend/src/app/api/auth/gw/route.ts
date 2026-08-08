import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const GW_BASE = process.env.GW_API_BASE ?? "https://gw.innogrid.com";
// B6에서 실제 세션 응답으로 확정할 세션 조회 엔드포인트 (후보: /gw/gw016A02)
const SESSION_PATH = "/gw/gw016A02";

interface GwAuthRequestBody {
  oAuthToken?: string;
  signKey?: string;
}

export async function POST(req: Request) {
  const { oAuthToken, signKey } = (await req
    .json()
    .catch(() => ({}))) as GwAuthRequestBody;
  if (!oAuthToken || !signKey) {
    return NextResponse.json({ error: "missing tokens" }, { status: 400 });
  }

  const transactionId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildGwSignature({ oAuthToken, signKey, transactionId, timestamp, pathname: SESSION_PATH });

  const gwRes = await fetch(`${GW_BASE}${SESSION_PATH}`, {
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
  // B6에서 실제 응답 구조로 경로 확정 (예: data.resultData.sessionInfo)
  const resultData = data?.resultData as Record<string, unknown> | undefined;
  const info = (resultData?.sessionInfo ?? data?.sessionInfo ?? {}) as Record<string, unknown>;
  const email = (info.user_email ?? info.user_default_email) as string | undefined;
  const name = info.user_name as string | undefined;
  if (!email || !isInnogridEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 403 });
  }

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
