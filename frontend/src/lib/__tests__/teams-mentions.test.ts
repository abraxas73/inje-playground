import { describe, expect, it } from "vitest";
import { isAcknowledgement, needsReply, nameCandidates, mentionsName, pickMentions, recentChats } from "@/lib/teams/mentions";
import type { ChatMessage, ChatSummary } from "@/lib/teams/chat";

const now = new Date("2026-10-05T00:00:00Z");
const me = { id: "me", displayName: "SeungUk Kang", mail: "seunguk.kang@innogrid.com", givenName: "SeungUk" };
const chat = (id: string, type: "group" | "oneOnOne", lastUpdated: string): ChatSummary => ({ id, type, topic: id === "g1" ? "센터 공지" : "김민준", members: [], webUrl: `https://teams/${id}`, lastUpdated });
const msg = (id: string, fromId: string, text: string, at: string): ChatMessage => ({ id, createdAt: at, modifiedAt: at, from: { id: fromId, name: fromId === "me" ? "강승욱" : "김민준" }, text, attachments: [] });

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
    const out = pickMentions(chats, { d1: [msg("4", "u2", "시간 되세요?", "2026-10-04T09:00:00Z"), msg("5", "me", "네 됩니다", "2026-10-04T09:10:00Z"), msg("6", "u2", "그럼 3시 괜찮으세요", "2026-10-04T09:20:00Z")] }, me, now, 2);
    expect(out.map((m) => m.id)).toEqual(["6"]);
  });
  it("기간 밖·빈 글은 빼고, 본문은 200자에서 자르며, 최신순 최대 10", () => {
    const long = `${"가".repeat(300)}?`;
    const many = Array.from({ length: 12 }, (_, i) => msg(`m${i}`, "u2", i === 11 ? long : `메시지 ${i} 확인 부탁드려요`, `2026-10-04T0${Math.min(9, i)}:${String(i).padStart(2, "0")}:00Z`));
    const out = pickMentions([chat("d1", "oneOnOne", "2026-10-04T10:00:00Z")], { d1: [...many, msg("x", "u2", "   ", "2026-10-04T10:00:00Z"), msg("old", "u2", "옛날", "2026-09-01T00:00:00Z")] }, me, now, 2);
    expect(out).toHaveLength(10);
    expect(out[0].id).toBe("m11");
    expect(out.find((m) => m.id === "m11")?.text).toHaveLength(201);
    expect(out.some((m) => m.id === "x" || m.id === "old")).toBe(false);
  });
});

describe("isAcknowledgement — 답할 필요 없는 맞장구", () => {
  it.each(["네", "넵 !!", "네 감사합니다", "넵 괜찮아요.", "넵넵~", "감사합니다 :)", "네 알겠습니다", "확인했습니다 👍", "ㅇㅋ", "OK", "넵 ㅎㅎ"])("맞장구: %s", (t) => {
    expect(isAcknowledgement(t)).toBe(true);
  });
  it.each(["네 내일 회의 몇 시죠?", "네 그런데 자료는 언제 주시나요", "확인 부탁드립니다", "감사합니다. 첨부 검토 후 회신 주세요", "?", "", "넵 근데 그건 좀 어렵겠네요"])("답 필요: %s", (t) => {
    expect(isAcknowledgement(t)).toBe(false);
  });
});

describe("pickMentions — 맞장구는 답장 대기에서 뺀다", () => {
  it("1:1에서 상대가 \"네\"·\"넵!!\"만 보냈으면 대기 아님, 질문은 대기", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const chats = [chat("d1", "oneOnOne", "2026-10-04T10:00:00Z")];
    const out = pickMentions(chats, { d1: [msg("1", "me", "자료 보냈습니다", "2026-10-04T09:00:00Z"), msg("2", "u2", "넵 !!", "2026-10-04T09:05:00Z"), msg("3", "u2", "네 감사합니다", "2026-10-04T09:06:00Z"), msg("4", "u2", "근데 회의는 몇 시예요?", "2026-10-04T09:07:00Z")] }, me, now, 2);
    expect(out.map((m) => m.id)).toEqual(["4"]);
  });
});

describe("needsReply — 질문·요청만 답장 대기", () => {
  it.each(["내일 회의 몇 시죠", "시간 되세요?", "자료 공유 가능할까요", "검토 부탁드립니다", "회신 주세요", "이거 어떻게 생각하세요", "참석하시나요 ㅎㅎ", "확인해 주시면 감사하겠습니다", "언제 끝나는지 알려줘"])("답 필요: %s", (t) => {
    expect(needsReply(t)).toBe(true);
  });
  it.each(["넵!", "네 감사합니다", "좋은 생각입니다! 공유해보겠습니다", "공유드립니다", "오늘 회의는 3시에 시작합니다.", "저도 그렇게 생각했어요 ㅎㅎ", "출근했습니다", "", "수고하세요"])("답 필요 없음: %s", (t) => {
    expect(needsReply(t)).toBe(false);
  });
  it("1:1에서 내 말 뒤 상대가 소감·알림만 보냈으면 대기 아님", () => {
    const chats = [chat("d1", "oneOnOne", "2026-10-04T10:00:00Z")];
    const out = pickMentions(chats, { d1: [msg("1", "me", "숨은 기능 찾기 이벤트도 좋을 것 같아요.", "2026-10-04T09:00:00Z"), msg("2", "u2", "오 좋은 생각입니다! 한번 준비해 볼게요", "2026-10-04T09:05:00Z")] }, me, now, 2);
    expect(out).toEqual([]);
  });
});

describe("byNewest — 채팅 목록 최신 순", () => {
  it("날짜까지 비교하고, 소수점 자릿수가 달라도·시각 없으면 맨 아래", async () => {
    const { byNewest } = await import("@/lib/teams/sort");
    const list = [
      { id: "어제 23:59", lastUpdated: "2026-10-22T14:59:00.1234567Z" },
      { id: "없음", lastUpdated: null },
      { id: "오늘 09:15", lastUpdated: "2026-10-23T00:15:00Z" },
      { id: "오늘 09:41", lastUpdated: "2026-10-23T00:41:00.5Z" },
      { id: "그제 10:00", lastUpdated: "2026-10-21T01:00:00Z" },
    ];
    expect([...list].sort(byNewest).map((c) => c.id)).toEqual(["오늘 09:41", "오늘 09:15", "어제 23:59", "그제 10:00", "없음"]);
  });
});
