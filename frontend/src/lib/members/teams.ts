/** 클라이언트 전용: 서버 라우트(/api/teams/members)를 통해 Graph 멤버 조회 */
import type { FetchLike } from "@/lib/notify/types";
import type { Member, MemberSource } from "./types";

export function createTeamsMemberSource(fetchImpl: FetchLike = fetch): MemberSource {
  return {
    provider: "teams",
    async listMembers({ signal } = {}) {
      const res = await fetchImpl("/api/teams/members", { signal });
      const data = (await res.json().catch(() => ({}))) as { members?: Member[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Teams 멤버 조회 실패 (${res.status})`);
      }
      return data.members ?? [];
    },
  };
}
