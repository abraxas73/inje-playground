import { describe, it, expect, vi } from "vitest";
import { fetchMembersFromWebhook, parseWebhookMembers } from "@/lib/teams-members-webhook";

function res(status: number, body: string): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body } as unknown as Response;
}

describe("parseWebhookMembers", () => {
  it("Office 365 Groups 커넥터 출력({value:[GraphUser]})을 그대로 받아 정규화·이름순 정렬", () => {
    expect(
      parseWebhookMembers({
        value: [
          { "@odata.type": "#microsoft.graph.user", id: "u2", displayName: "이영희", mail: null, userPrincipalName: "yh@innogrid.com" },
          { id: "u1", displayName: "강승억", mail: "su@innogrid.com", userPrincipalName: "su_upn@innogrid.com" },
          { id: "u3", displayName: "  ", mail: "x@innogrid.com" },
        ],
      })
    ).toEqual([
      { id: "u1", name: "강승억", email: "su@innogrid.com" },
      { id: "u2", name: "이영희", email: "yh@innogrid.com" },
    ]);
  });

  it("PascalCase(Office 365 Users 스타일) 키와 정규화된 {members:[{id,name,email}]}·배열도 허용", () => {
    expect(parseWebhookMembers({ value: [{ Id: "u1", DisplayName: "홍길동", Mail: "hong@innogrid.com" }] })).toEqual([
      { id: "u1", name: "홍길동", email: "hong@innogrid.com" },
    ]);
    expect(parseWebhookMembers({ members: [{ id: "u1", name: "홍길동", email: "hong@innogrid.com" }] })).toEqual([
      { id: "u1", name: "홍길동", email: "hong@innogrid.com" },
    ]);
    expect(parseWebhookMembers([{ id: "u1", name: "홍길동" }])).toEqual([{ id: "u1", name: "홍길동", email: undefined }]);
  });

  it("배열이 없는 형식은 설명 오류", () => {
    expect(() => parseWebhookMembers({ foo: 1 })).toThrow("Teams 멤버 웹훅 응답 형식이 올바르지 않습니다");
    expect(() => parseWebhookMembers(null)).toThrow("Teams 멤버 웹훅 응답 형식이 올바르지 않습니다");
  });
});

describe("fetchMembersFromWebhook", () => {
  it("웹훅에 {groupId}를 JSON POST 하고 응답을 정규화", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(res(200, JSON.stringify({ value: [{ id: "u1", displayName: "강승억", mail: "su@innogrid.com" }] })));
    const members = await fetchMembersFromWebhook("https://prod-xx.logic.azure.com/wf/members", "g1", fetchImpl);
    expect(members).toEqual([{ id: "u1", name: "강승억", email: "su@innogrid.com" }]);
    expect(fetchImpl).toHaveBeenCalledWith("https://prod-xx.logic.azure.com/wf/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId: "g1" }),
    });
  });

  it("groupId가 없으면 빈 문자열로 보낸다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res(200, JSON.stringify({ value: [] })));
    await fetchMembersFromWebhook("https://w", undefined, fetchImpl);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ groupId: "" });
  });

  it("비정상 응답은 status·본문을 담아 throw, JSON 아님도 throw", async () => {
    await expect(fetchMembersFromWebhook("https://w", "g1", vi.fn().mockResolvedValue(res(401, "denied")))).rejects.toThrow(
      "Teams 멤버 웹훅 오류 (401): denied"
    );
    await expect(fetchMembersFromWebhook("https://w", "g1", vi.fn().mockResolvedValue(res(200, "<html>")))).rejects.toThrow(
      "Teams 멤버 웹훅 응답이 JSON이 아닙니다"
    );
  });
});
