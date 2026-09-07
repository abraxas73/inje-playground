/**
 * 폴더 링크(공유 URL) → Graph shares 해석까지의 라우트 공용 절차.
 * 프로젝트 폴더 지정(`/api/rfp/projects/[id]/sharepoint/folder`)과 개인 기본 폴더
 * (`/api/users/sharepoint-folder`)가 **같은 검증·오류 문구**를 쓰도록 한 곳에 모았다.
 *
 * 오류 응답 규격(3단계 스펙 §4·§9): 400 형식·해석 실패·{code:not_connected} / 403 볼 권한 없음 /
 * 409 {code:reconnect} / 500 설정 누락 / 502 Graph 오류. 토큰은 어떤 로그·응답에도 쓰지 않는다.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "./config";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "./connections";
import { FolderResolveError, GraphError, resolveFolder } from "./graph-drive";
import { OAuthError, oauthErrorMessage } from "./oauth";
import type { SharepointFolder } from "@/types/rfp";

export const FOLDER_URL_MAX = 2000;

/** 붙여넣은 값이 폴더 링크 꼴인지(형식만) */
export function parseFolderUrl(raw: unknown): { ok: true; url: string } | { ok: false; error: string } {
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url || url.length > FOLDER_URL_MAX || !/^https:\/\//i.test(url)) {
    return { ok: false, error: `https로 시작하는 폴더 링크를 붙여 주세요(${FOLDER_URL_MAX}자 이하).` };
  }
  return { ok: true, url };
}

export type FolderResolveResult = { ok: true; folder: SharepointFolder } | { ok: false; response: NextResponse };

/** 세션 사용자의 위임 토큰으로 폴더 링크를 해석해 저장용 SharepointFolder를 만든다. */
export async function resolveFolderForUser(admin: SupabaseClient, userId: string, url: string): Promise<FolderResolveResult> {
  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return { ok: false, response: NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 }) };
  }

  let token: string;
  try {
    token = await getAccessTokenForUser(admin, userId, { app: cfg.config.app, encKey: cfg.config.encKey });
  } catch (e) {
    if (e instanceof NotConnectedError) return { ok: false, response: NextResponse.json({ error: e.message, code: "not_connected" }, { status: 400 }) };
    if (e instanceof ReconnectRequiredError) return { ok: false, response: NextResponse.json({ error: e.message, code: "reconnect" }, { status: 409 }) };
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status})`);
      return { ok: false, response: NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 }) };
    }
    return { ok: false, response: NextResponse.json({ error: e instanceof Error ? e.message : "토큰을 발급하지 못했습니다." }, { status: 500 }) };
  }

  try {
    const resolved = await resolveFolder(token, url);
    return {
      ok: true,
      folder: { url, driveId: resolved.driveId, itemId: resolved.itemId, name: resolved.name, webUrl: resolved.webUrl, setBy: userId, setAt: new Date().toISOString() },
    };
  } catch (e) {
    if (e instanceof FolderResolveError) return { ok: false, response: NextResponse.json({ error: e.message }, { status: e.status }) };
    if (e instanceof GraphError) {
      console.error(`[ms] 폴더 해석 실패 status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
      return { ok: false, response: NextResponse.json({ error: `SharePoint 응답 오류(${e.status})` }, { status: 502 }) };
    }
    return { ok: false, response: NextResponse.json({ error: e instanceof Error ? e.message : "폴더를 해석하지 못했습니다." }, { status: 500 }) };
  }
}
