/**
 * 클라이언트 전용: 앱 사용자 명단(user_profiles — 로그인한 적 있는 구성원, guest 제외)을
 * 서버 라우트(/api/members/users)로 조회. 외부 연동·라이선스·관리자 동의가 필요 없다.
 */
import type { FetchLike } from "@/lib/notify/types";
import type { Member, MemberSource } from "./types";

export function createAppUsersMemberSource(fetchImpl: FetchLike = fetch): MemberSource {
  return {
    provider: "users",
    async listMembers({ signal } = {}) {
      const res = await fetchImpl("/api/members/users", { signal });
      const data = (await res.json().catch(() => ({}))) as { members?: Member[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `앱 사용자 명단 조회 실패 (${res.status})`);
      }
      return data.members ?? [];
    },
  };
}
