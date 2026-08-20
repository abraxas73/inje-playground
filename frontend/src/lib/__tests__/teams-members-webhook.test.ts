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

  it("@odata.nextLink가 있으면(페이지네이션 미설정으로 잘린 응답) 조용히 받지 않고 throw", () => {
    expect(() =>
      parseWebhookMembers({ value: [{ id: "u1", displayName: "A" }], "@odata.nextLink": "https://graph.microsoft.com/v1.0/groups/g/members?$skiptoken=x" })
    ).toThrow("Teams 멤버 웹훅 응답이 잘렸습니다");
  });

  it("value/members가 null이면 빈 목록", () => {
    expect(parseWebhookMembers({ value: null })).toEqual([]);
    expect(parseWebhookMembers({ members: null })).toEqual([]);
  });

  it("이메일 키 우선순위는 평탄한 체인(mail → Mail → userPrincipalName → … → Email), 빈 문자열은 건너뜀", () => {
    expect(parseWebhookMembers([{ id: "u1", displayName: "A", mail: "", Mail: "m@x.com" }])).toEqual([{ id: "u1", name: "A", email: "m@x.com" }]);
    expect(parseWebhookMembers([{ id: "u1", displayName: "A", mail: "   ", userPrincipalName: "upn@x.com" }])).toEqual([{ id: "u1", name: "A", email: "upn@x.com" }]);
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

  it("오류 본문은 500자로 잘라 담는다", async () => {
    const big = "x".repeat(2000);
    await expect(fetchMembersFromWebhook("https://w", "g1", vi.fn().mockResolvedValue(res(500, big)))).rejects.toThrow(
      `Teams 멤버 웹훅 오류 (500): ${"x".repeat(500)}…`
    );
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
