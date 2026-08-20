/**
 * Power Automate "멤버 목록" 흐름을 통한 Teams 멤버 조회 — 서버 전용.
 * Graph 애플리케이션 권한(GroupMember.Read.All)에 테넌트 관리자 동의를 받을 수 없을 때의 대안:
 *   HTTP 요청을 받은 경우 → Office 365 Groups "그룹 구성원 나열" → 응답(본문 = 나열 결과 그대로)
 * 흐름 소유자의 위임 권한으로 동작하므로 앱 등록 동의가 필요 없다.
 */
import type { Member } from "@/lib/members/types";
import type { FetchLike } from "@/lib/notify/types";
import { normalizeGraphUsers } from "@/lib/teams-graph";

/**
 * 웹훅 응답 본문 → Member[].
 * 허용 형식: {value:[...]}(Office 365 Groups 커넥터 출력 그대로), {members:[...]}, 또는 배열.
 * 각 항목은 Graph 사용자(camelCase/PascalCase) 또는 정규화된 {id,name,email} 모두 허용.
 */
export function parseWebhookMembers(data: unknown): Member[] {
  let list: unknown[] | null = null;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === "object") {
    const obj = data as { members?: unknown; value?: unknown };
    if (Array.isArray(obj.members)) list = obj.members;
    else if (Array.isArray(obj.value)) list = obj.value;
  }
  if (!list) {
    throw new Error("Teams 멤버 웹훅 응답 형식이 올바르지 않습니다(value 또는 members 배열 필요).");
  }
  return normalizeGraphUsers(list);
}

/** 웹훅에 {groupId}를 POST 하고 멤버 목록을 돌려준다. 실패 시 status·본문을 담아 throw. */
export async function fetchMembersFromWebhook(
  url: string,
  groupId: string | undefined,
  fetchImpl: FetchLike = fetch
): Promise<Member[]> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ groupId: groupId ?? "" }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Teams 멤버 웹훅 오류 (${res.status}): ${text}`);

  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("Teams 멤버 웹훅 응답이 JSON이 아닙니다.");
  }
  return parseWebhookMembers(data);
}
