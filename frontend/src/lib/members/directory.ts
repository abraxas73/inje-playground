import type { FetchLike } from "@/lib/notify/types";
import type { Member, MemberSource } from "./types";

/**
 * 클라이언트 전용: 서버 라우트(/api/members/directory)로 사내 조직도 명부(company_directory, 아마란스 동기화)를 조회.
 * 전 직원(활성)과 팀이 들어 있고 외부 연동·관리자 동의가 필요 없다. 최신성은 운영자 Mac 동기화(런북 docs/company-directory.md)에 따른다.
 */
export function createDirectoryMemberSource(fetchImpl: FetchLike = fetch): MemberSource {
  return {
    provider: "directory",
    async listMembers(opts) {
      const res = await fetchImpl("/api/members/directory", { signal: opts?.signal });
      let body: { members?: Member[]; error?: string } = {};
      try {
        body = (await res.json()) as typeof body;
      } catch {
        // 본문 없음
      }
      if (!res.ok) throw new Error(body.error ?? `사내 조직도 명부를 불러오지 못했습니다 (${res.status})`);
      return body.members ?? [];
    },
  };
}
