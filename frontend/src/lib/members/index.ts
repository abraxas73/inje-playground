import type { Provider } from "@/lib/providers";
import { createDoorayMemberSource } from "./dooray";
import { createTeamsMemberSource } from "./teams";
import type { MemberSource } from "./types";

export type { Member, MemberSource } from "./types";

/** provider(settings.member_source_provider)에 맞는 MemberSource. Dooray는 토큰/프로젝트ID가 필요 */
export function getMemberSource(
  provider: Provider,
  dooray: { token: string; projectId: string }
): MemberSource {
  return provider === "teams" ? createTeamsMemberSource() : createDoorayMemberSource(dooray);
}
