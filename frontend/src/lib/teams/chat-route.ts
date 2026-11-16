import { NextResponse } from "next/server";
import { GraphError } from "@/lib/ms/graph-drive";
import { OAuthError } from "@/lib/ms/oauth";
import { CHAT_ID_RE } from "./chat";

export const TEAMS_CHAT_RECONNECT_MESSAGE = "Teams 채팅 권한이 없거나 이 채팅에 참여하고 있지 않습니다. 설정에서 Microsoft 계정을 다시 연결해 권한(Chat.ReadWrite)을 추가하세요.";

/** 요청의 chat 값 → 유효한 채팅 ID 또는 null */
export function parseChatId(raw: unknown): string | null {
  return typeof raw === "string" && CHAT_ID_RE.test(raw.trim()) ? raw.trim() : null;
}

export const TEAMS_CHAT_FORBIDDEN_MESSAGE = "이 채팅을 볼 수 없습니다. 참여하지 않았거나 회의 채팅처럼 접근이 제한된 채팅입니다.";

/**
 * Graph 오류(GraphError, fetchMe의 OAuthError) → 응답. 401/403은 스코프 미동의로 보고 재연결 안내(409 reconnect).
 * 단 채팅 하나를 다루는 라우트([opts.chat])의 Graph 403은 그 채팅만의 거절(미참여·회의 채팅)이라 403 chat_forbidden —
 * 연결은 멀쩡한데 "다시 연결"을 띄우던 문제(2026-11-16, 모든 연결에 Chat.ReadWrite가 있음). 429는 503 잠시 뒤, 그 외 502.
 * 다른 예외(네트워크·DB)도 HTML 500 대신 JSON 502로.
 */
export function graphErrorResponse(e: unknown, opts: { chat?: boolean } = {}): NextResponse {
  if (e instanceof OAuthError) {
    if (e.status === 401 || e.status === 403) return NextResponse.json({ error: TEAMS_CHAT_RECONNECT_MESSAGE, code: "reconnect" }, { status: 409 });
    console.error(`[teams-chat] ${e.code} (${e.status})`);
    return NextResponse.json({ error: `Teams 요청이 실패했습니다 (${e.status})` }, { status: 502 });
  }
  if (e instanceof GraphError) {
    if (e.status === 403 && opts.chat) {
      console.warn(`[teams-chat] Graph 403 ${e.code} request-id=${e.requestId ?? "-"} (채팅 거절)`);
      return NextResponse.json({ error: TEAMS_CHAT_FORBIDDEN_MESSAGE, code: "chat_forbidden" }, { status: 403 });
    }
    if (e.status === 429) return NextResponse.json({ error: "Teams 요청이 많아 잠시 쉬는 중입니다. 잠시 뒤 다시 시도하세요." }, { status: 503 });
    if (e.status === 401 || e.status === 403) {
      // 권한 거절 이유(필요 권한 이름 등)는 Graph 메시지에만 있다 — 진단용으로 남긴다(토큰·채팅 내용 없음)
      console.warn(`[teams-chat] Graph ${e.status} ${e.code} request-id=${e.requestId ?? "-"} — ${e.message.slice(0, 300)}`);
      return NextResponse.json({ error: TEAMS_CHAT_RECONNECT_MESSAGE, code: "reconnect" }, { status: 409 });
    }
    console.error(`[teams-chat] Graph ${e.status} ${e.code} request-id=${e.requestId ?? "-"} — ${e.message.slice(0, 200)}`);
    return NextResponse.json({ error: `Teams 요청이 실패했습니다 (${e.status})` }, { status: 502 });
  }
  console.error("[teams-chat] 예외:", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: "Teams에 연결하지 못했습니다. 잠시 뒤 다시 시도하세요." }, { status: 502 });
}
