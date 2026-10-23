import { NextResponse } from "next/server";
import { GraphError } from "@/lib/ms/graph-drive";
import { OAuthError } from "@/lib/ms/oauth";
import { CHAT_ID_RE } from "./chat";

export const TEAMS_CHAT_RECONNECT_MESSAGE = "Teams 채팅 권한이 없거나 이 채팅에 참여하고 있지 않습니다. 설정에서 Microsoft 계정을 다시 연결해 권한(Chat.ReadWrite)을 추가하세요.";

/** 요청의 chat 값 → 유효한 채팅 ID 또는 null */
export function parseChatId(raw: unknown): string | null {
  return typeof raw === "string" && CHAT_ID_RE.test(raw.trim()) ? raw.trim() : null;
}

/** Graph 오류(GraphError, fetchMe의 OAuthError) → 응답. 401/403은 스코프 미동의 또는 채팅 미참여로 보고 재연결 안내(409 reconnect). 그 외 502. 다른 예외(네트워크·DB)도 HTML 500 대신 JSON 502로. */
export function graphErrorResponse(e: unknown): NextResponse {
  if (e instanceof OAuthError) {
    if (e.status === 401 || e.status === 403) return NextResponse.json({ error: TEAMS_CHAT_RECONNECT_MESSAGE, code: "reconnect" }, { status: 409 });
    console.error(`[teams-chat] ${e.code} (${e.status})`);
    return NextResponse.json({ error: `Teams 요청이 실패했습니다 (${e.status})` }, { status: 502 });
  }
  if (e instanceof GraphError) {
    if (e.status === 401 || e.status === 403) return NextResponse.json({ error: TEAMS_CHAT_RECONNECT_MESSAGE, code: "reconnect" }, { status: 409 });
    console.error(`[teams-chat] Graph ${e.status} ${e.code} request-id=${e.requestId ?? "-"} — ${e.message.slice(0, 200)}`);
    return NextResponse.json({ error: `Teams 요청이 실패했습니다 (${e.status})` }, { status: 502 });
  }
  console.error("[teams-chat] 예외:", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Teams에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요." }, { status: 502 });
}
