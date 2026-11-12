// frontend/src/lib/claude-usage/seat-notice.ts
import { GRAPH_BASE } from "@/lib/teams-graph";
import { graph, sendChatMessage } from "@/lib/teams/chat";
import { IDLE_DAYS } from "@/lib/claude-usage/idle-seats";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** 자동 해제 안내 문구 */
export function idleReleaseText(orgName: string): string {
  return `[INNOCREW 자동 안내] 최근 ${IDLE_DAYS}일 동안 Claude(채팅·Cowork·Claude Code) 사용 기록이 없어 Claude 조직 "${orgName}"의 시트를 해제했습니다. 계정과 조직 멤버 자격은 그대로이며, 다시 쓰시려면 이 대화로 말씀해 주시면 시트를 다시 할당해 드립니다.`;
}

/**
 * 운영자(자동 해제 요청자) 위임 토큰으로 대상자와 1:1 Teams 채팅을 만들거나(이미 있으면 Graph가 그 채팅을 돌려준다) 열어 안내를 보낸다.
 * 운영 settings에 Teams DM 웹훅이 없어(2026-11-12) 위임 Chat.ReadWrite를 쓴다.
 */
export async function sendIdleReleaseNotice(token: string, email: string, orgName: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!/^[^\s@'()]+@[^\s@'()]+$/.test(email)) throw new Error("이메일 형식이 아닙니다");
  // Graph 문서 예와 같이 bind 주소에 UPN을 그대로 넣는다(퍼센트 인코딩하면 사용자를 못 찾는다)
  const member = (who: string) => ({
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: ["owner"],
    "user@odata.bind": `${GRAPH_BASE}/users('${who}')`,
  });
  const me = (await graph(token, `${GRAPH_BASE}/me?$select=id`, {}, fetchImpl)) as { id: string };
  const chat = (await graph(token, `${GRAPH_BASE}/chats`, { method: "POST", body: JSON.stringify({ chatType: "oneOnOne", members: [member(me.id), member(email)] }) }, fetchImpl)) as { id: string };
  await sendChatMessage(token, chat.id, idleReleaseText(orgName), fetchImpl);
}
