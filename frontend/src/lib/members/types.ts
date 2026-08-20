import type { MemberSourceProvider } from "@/lib/providers";

/** provider 중립 멤버. Dooray는 email 없음, Teams는 Graph mail/UPN */
export interface Member {
  id: string;
  name: string;
  email?: string;
}

export interface MemberSource {
  readonly provider: MemberSourceProvider;
  listMembers(opts?: { signal?: AbortSignal }): Promise<Member[]>;
}
