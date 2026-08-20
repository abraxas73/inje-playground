/** 클라이언트 전용: Chrome 확장 브리지를 통한 Dooray 프로젝트 멤버 조회를 MemberSource로 래핑 */
import { fetchProjectMembers } from "@/lib/dooray-client";
import type { MemberSource } from "./types";

export function createDoorayMemberSource(cfg: { token: string; projectId: string }): MemberSource {
  return {
    provider: "dooray",
    listMembers: ({ signal } = {}) => fetchProjectMembers(cfg.token, cfg.projectId, signal),
  };
}
