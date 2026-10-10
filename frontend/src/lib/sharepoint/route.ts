import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { GraphError } from "@/lib/ms/graph-drive";
import { SharepointError } from "./core";

type Auth = Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>;
export const spJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export function spFailure(e: unknown) {
  if (e instanceof SharepointError) return spJson({ error: e.message, code: e.code }, e.status);
  if (e instanceof GraphError) {
    console.error(`[sharepoint] Graph 실패 status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
    if (e.status === 401) return spJson({ error: "Microsoft 연결이 만료되었습니다. 설정에서 다시 연결하세요.", code: "reconnect" }, 409);
    return spJson({ error: `SharePoint 응답 오류(${e.status}). 잠시 후 다시 시도하세요.` }, 502);
  }
  console.error("[sharepoint] 요청 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
  return spJson({ error: "SharePoint 요청을 처리하지 못했습니다. 잠시 후 다시 시도하세요." }, 502);
}
/** 로그인 확인 → 본인 Graph 토큰(미연결 400 not_connected / 만료 409 reconnect / 설정 누락 500) → handler */
export async function withSharepoint(handler: (token: string, auth: Auth) => Promise<unknown>) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try { return spJson(await handler(tok.token, auth)); } catch (e) { return spFailure(e); }
}
