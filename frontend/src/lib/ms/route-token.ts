import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "./config";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "./connections";
import { OAuthError, oauthErrorMessage } from "./oauth";

export type GraphTokenResult = { ok: true; token: string } | { ok: false; response: NextResponse };

/**
 * 라우트용: settings+env 설정을 읽고 세션 사용자의 Graph access 토큰을 발급한다.
 * 실패는 3단계 업로드 라우트와 같은 상태·문구·code로 응답을 만든다(500 설정 누락 / 400 not_connected / 409 reconnect / 502 OAuth).
 * 토큰은 로그에 쓰지 않는다.
 */
export async function graphTokenForRoute(admin: SupabaseClient, userId: string): Promise<GraphTokenResult> {
  const supabase = await createServerSupabase();
  const cfg = await loadMsConfig(supabase);
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return { ok: false, response: NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 }) };
  }
  try {
    const token = await getAccessTokenForUser(admin, userId, { app: cfg.config.app, encKey: cfg.config.encKey });
    return { ok: true, token };
  } catch (e) {
    if (e instanceof NotConnectedError) return { ok: false, response: NextResponse.json({ error: "Microsoft 계정을 먼저 연결하세요.", code: "not_connected" }, { status: 400 }) };
    if (e instanceof ReconnectRequiredError) return { ok: false, response: NextResponse.json({ error: e.message, code: "reconnect" }, { status: 409 }) };
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status})`);
      return { ok: false, response: NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 }) };
    }
    throw e;
  }
}
