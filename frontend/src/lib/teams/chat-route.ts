import { NextResponse } from "next/server";
import { GraphError } from "@/lib/ms/graph-drive";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadSettings } from "@/lib/settings-server";
import { TEAMS_CHAT_SETTING_KEYS } from "./chat";

export const TEAMS_CHAT_RECONNECT_MESSAGE = "Teams 채팅 권한이 없습니다. 설정에서 Microsoft 계정을 다시 연결해 권한(Chat.ReadWrite)을 추가하세요.";

/** settings의 지정 그룹 채팅 */
export async function loadChatTarget(): Promise<{ chatId: string | null; topic: string | null }> {
  const supabase = await createServerSupabase();
  const s = await loadSettings(supabase, TEAMS_CHAT_SETTING_KEYS);
  const chatId = s.teams_chat_id?.trim() || null;
  return { chatId, topic: s.teams_chat_topic?.trim() || null };
}

/** Graph 오류 → 응답. 401/403은 스코프 미동의(또는 채팅 미참여)로 보고 재연결 안내(409 reconnect). 그 외 502. 다른 예외는 다시 던진다. */
export function graphErrorResponse(e: unknown): NextResponse {
  if (e instanceof GraphError) {
    if (e.status === 401 || e.status === 403) return NextResponse.json({ error: TEAMS_CHAT_RECONNECT_MESSAGE, code: "reconnect" }, { status: 409 });
    console.error(`[teams-chat] Graph ${e.status} ${e.code} request-id=${e.requestId ?? "-"}`);
    return NextResponse.json({ error: `Teams 요청이 실패했습니다 (${e.status})` }, { status: 502 });
  }
  throw e;
}
