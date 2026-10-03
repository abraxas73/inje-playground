import type { MemberSourceProvider } from "@/lib/providers";

/** provider 중립 멤버. Dooray는 email 없음, Teams는 Graph mail/UPN */
export interface Member {
  id: string;
  name: string;
  email?: string;
  /** 사내 조직도 명부(directory)만: 말단 부서명 */
  team?: string;
  /** 사내 조직도 명부(directory)만: 조직 경로 [부문, 본부, 센터, 팀] — 모달의 조직 필터용 */
  units?: string[];
}

export interface MemberSource {
  readonly provider: MemberSourceProvider;
  listMembers(opts?: { signal?: AbortSignal }): Promise<Member[]>;
}
