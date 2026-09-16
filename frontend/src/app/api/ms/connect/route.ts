import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { newNonce, signState, STATE_TTL_S } from "@/lib/ms/crypto";
import { buildAuthorizeUrl } from "@/lib/ms/oauth";
import { requestOrigin, resolveRedirectOrigin, sanitizeReturnTo } from "@/lib/ms/origin";

export const runtime = "nodejs";

/**
 * GET /api/ms/connect?returnTo=/settings — 세션 사용자·returnTo·만기를 담은 state를 서명해 Azure authorize로 302 (스펙 §3.1).
 * 400 허용되지 않은 오리진 / 500 설정 누락(항목명 포함).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const origin = resolveRedirectOrigin(requestOrigin(request));
  if (!origin) return NextResponse.json({ error: "허용되지 않은 오리진입니다." }, { status: 400 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }

  const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const state = signState({ u: auth.userId, n: newNonce(), r: returnTo, e: Math.floor(Date.now() / 1000) + STATE_TTL_S }, cfg.config.encKey);
  const url = buildAuthorizeUrl({ tenantId: cfg.config.app.tenantId, clientId: cfg.config.app.clientId, redirectUri: `${origin}/api/ms/callback`, state });
  return NextResponse.redirect(url, 302);
}
