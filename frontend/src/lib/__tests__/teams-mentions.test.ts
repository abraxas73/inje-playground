import { describe, expect, it } from "vitest";
import { nameCandidates, mentionsName, pickMentions, recentChats } from "@/lib/teams/mentions";
import type { ChatMessage, ChatSummary } from "@/lib/teams/chat";

const now = new Date("2026-10-05T00:00:00Z");
const me = { id: "me", displayName: "SeungUk Kang", mail: "seunguk.kang@innogrid.com", givenName: "SeungUk" };
const chat = (id: string, type: "group" | "oneOnOne", lastUpdated: string): ChatSummary => ({ id, type, topic: id === "g1" ? "센터 공지" : "김민준", members: [], webUrl: `https://teams/${id}`, lastUpdated });
const msg = (id: string, fromId: string, text: string, at: string): ChatMessage => ({ id, createdAt: at, modifiedAt: at, from: { id: fromId, name: fromId === "me" ? "강승욱" : "김민준" }, text, attachments: 0 });

describe("recentChats", () => {
  it("기간 안에 활동한 채팅만 최근 순으로 최대 limit", () => {
    const chats = [chat("g1", "group", "2026-10-04T10:00:00Z"), chat("old", "group", "2026-09-20T10:00:00Z"), chat("d1", "oneOnOne", "2026-10-03T10:00:00Z")];
    expect(recentChats(chats, now, 2).map((c) => c.id)).toEqual(["g1", "d1"]);
    expect(recentChats(chats, now, 2, 1).map((c) => c.id)).toEqual(["g1"]);
  });
});
describe("mentionsName", () => {
  it("표시 이름·이름·메일 로컬파트·한글 이름 후보 중 하나라도 들어가면 멘션", () => {
    const c = nameCandidates({ ...me, koreanName: "강승욱" });
    expect(mentionsName("@SeungUk Kang 확인 부탁", c)).toBe(true);
    expect(mentionsName("강승욱님 보셨나요", c)).toBe(true);
    expect(mentionsName("seunguk.kang 참조", c)).toBe(true);
    expect(mentionsName("다들 수고하셨습니다", c)).toBe(false);
  });
  it("후보가 비면 false", () => expect(mentionsName("아무 글", [])).toBe(false));
});
describe("pickMentions", () => {
  const chats = [chat("g1", "group", "2026-10-04T10:00:00Z"), chat("d1", "oneOnOne", "2026-10-04T09:00:00Z")];
  it("그룹은 내 이름이 들어간 남의 메시지, 1:1은 남의 메시지 전부 — 내 메시지는 제외", () => {
    const out = pickMentions(chats, {
      g1: [msg("1", "u2", "@SeungUk Kang 결재 부탁드립니다", "2026-10-04T10:00:00Z"), msg("2", "u2", "다들 수고", "2026-10-04T10:05:00Z"), msg("3", "me", "@김민준 네", "2026-10-04T09:00:00Z")],
      d1: [msg("4", "u2", "시간 되세요?", "2026-10-04T09:00:00Z")],
    }, me, now, 2);
    expect(out.map((m) => m.id)).toEqual(["1", "4"]);
    expect(out[0]).toMatchObject({ chatId: "g1", topic: "센터 공지", type: "group", from: "김민준", webUrl: "https://teams/g1" });
  });
  it("그 뒤에 내가 보낸 메시지가 있으면 이미 답한 것 — 제외", () => {
    const out = pickMentions(chats, { d1: [msg("4", "u2", "시간 되세요?", "2026-10-04T09:00:00Z"), msg("5", "me", "네 됩니다", "2026-10-04T09:10:00Z"), msg("6", "u2", "그럼 3시에", "2026-10-04T09:20:00Z")] }, me, now, 2);
    expect(out.map((m) => m.id)).toEqual(["6"]);
  });
  it("기간 밖·빈 글은 빼고, 본문은 200자에서 자르며, 최신순 최대 10", () => {
    const long = "가".repeat(300);
    const many = Array.from({ length: 12 }, (_, i) => msg(`m${i}`, "u2", i === 11 ? long : `메시지 ${i}`, `2026-10-04T0${Math.min(9, i)}:${String(i).padStart(2, "0")}:00Z`));
    const out = pickMentions([chat("d1", "oneOnOne", "2026-10-04T10:00:00Z")], { d1: [...many, msg("x", "u2", "   ", "2026-10-04T10:00:00Z"), msg("old", "u2", "옛날", "2026-09-01T00:00:00Z")] }, me, now, 2);
    expect(out).toHaveLength(10);
    expect(out[0].id).toBe("m11");
    expect(out.find((m) => m.id === "m11")?.text).toHaveLength(201);
    expect(out.some((m) => m.id === "x" || m.id === "old")).toBe(false);
  });
});
