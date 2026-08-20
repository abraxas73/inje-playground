import type { MemberSourceProvider } from "@/lib/providers";
import { createDoorayMemberSource } from "./dooray";
import { createTeamsMemberSource } from "./teams";
import { createAppUsersMemberSource } from "./users";
import type { MemberSource } from "./types";

export type { Member, MemberSource } from "./types";

/** provider(settings.member_source_provider)에 맞는 MemberSource. Dooray만 토큰/프로젝트ID가 필요 */
export function getMemberSource(
  provider: MemberSourceProvider,
  dooray: { token: string; projectId: string }
): MemberSource {
  if (provider === "teams") return createTeamsMemberSource();
  if (provider === "users") return createAppUsersMemberSource();
  return createDoorayMemberSource(dooray);
}
