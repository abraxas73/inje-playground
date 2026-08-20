import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/dooray-client", () => ({
  fetchProjectMembers: vi.fn(async (token: string, projectId: string) => [{ id: `${token}-${projectId}`, name: "홍길동" }]),
}));

import { createTeamsMemberSource } from "@/lib/members/teams";
import { createDoorayMemberSource } from "@/lib/members/dooray";
import { createAppUsersMemberSource } from "@/lib/members/users";
import { getMemberSource } from "@/lib/members";
import { fetchProjectMembers } from "@/lib/dooray-client";

describe("createTeamsMemberSource", () => {
  it("/api/teams/members를 호출해 members를 돌려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ members: [{ id: "u1", name: "강승억", email: "su@innogrid.com" }] }) });
    const src = createTeamsMemberSource(fetchImpl as never);
    expect(src.provider).toBe("teams");
    const signal = new AbortController().signal;
    expect(await src.listMembers({ signal })).toEqual([{ id: "u1", name: "강승억", email: "su@innogrid.com" }]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/teams/members", { signal });
  });

  it("실패 응답의 error 메시지를 throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Teams 설정이 누락되었습니다: teams_group_id" }) });
    await expect(createTeamsMemberSource(fetchImpl as never).listMembers()).rejects.toThrow("Teams 설정이 누락되었습니다: teams_group_id");
  });

  it("본문 파싱 실패 시 status 기반 메시지", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("x"); } });
    await expect(createTeamsMemberSource(fetchImpl as never).listMembers()).rejects.toThrow("Teams 멤버 조회 실패 (502)");
  });
});

describe("createAppUsersMemberSource", () => {
  it("/api/members/users를 호출해 members를 돌려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ members: [{ id: "uid-1", name: "강승억", email: "su@innogrid.com" }] }) });
    const src = createAppUsersMemberSource(fetchImpl as never);
    expect(src.provider).toBe("users");
    const signal = new AbortController().signal;
    expect(await src.listMembers({ signal })).toEqual([{ id: "uid-1", name: "강승억", email: "su@innogrid.com" }]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/members/users", { signal });
  });

  it("실패 응답의 error 메시지를 throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: "Unauthorized" }) });
    await expect(createAppUsersMemberSource(fetchImpl as never).listMembers()).rejects.toThrow("Unauthorized");
  });
});

describe("createDoorayMemberSource / getMemberSource", () => {
  it("Dooray 소스는 브리지 fetchProjectMembers를 위임", async () => {
    const src = createDoorayMemberSource({ token: "tok", projectId: "p1" });
    expect(src.provider).toBe("dooray");
    expect(await src.listMembers()).toEqual([{ id: "tok-p1", name: "홍길동" }]);
    expect(fetchProjectMembers).toHaveBeenCalledWith("tok", "p1", undefined);
  });

  it("getMemberSource는 provider로 분기", () => {
    expect(getMemberSource("teams", { token: "", projectId: "" }).provider).toBe("teams");
    expect(getMemberSource("users", { token: "", projectId: "" }).provider).toBe("users");
    expect(getMemberSource("dooray", { token: "t", projectId: "p" }).provider).toBe("dooray");
  });
});
