import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { newNonce, signState, STATE_TTL_S } from "@/lib/ms/crypto";
import { buildAuthorizeUrl } from "@/lib/ms/oauth";
import { requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";

export const runtime = "nodejs";

/** 네이티브 Bearer 세션으로 Microsoft 승인 URL을 발급한다. 별도 브라우저 Supabase 세션은 만들지 않는다. */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const cfg = await loadMsConfig(auth.admin);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }

  const body = await request.json().catch(() => ({})) as { returnTo?: unknown };
  const returnTo = sanitizeReturnTo(typeof body.returnTo === "string" ? body.returnTo : null);
  const state = signState({
    u: auth.userId,
    n: newNonce(),
    r: returnTo,
    e: Math.floor(Date.now() / 1000) + STATE_TTL_S,
    a: true,
  }, cfg.config.encKey);
  const url = buildAuthorizeUrl({
    tenantId: cfg.config.app.tenantId,
    clientId: cfg.config.app.clientId,
    redirectUri: `${origin}/api/ms/callback`,
    state,
    loginHint: auth.email,
  });
  return NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
}
