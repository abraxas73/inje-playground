import { describe, expect, it } from "vitest";
import { briefingEnabled, briefingSystemPrompt, countsOf, sanitizePayload } from "@/lib/mobile/briefing";

const full = { date: "2026-10-05 (월) 08:40", name: "강승욱", meetings: [{ time: "10:00–11:00", title: "주간회의", place: "3층" }], tomorrow: 2, absences: [{ who: "김민준", what: "연차" }], approvals: [{ title: "휴가 신청", from: "이서연", days: 3, unread: true }], mails: [{ from: "박지훈", subject: "견적", when: "09:12" }], mentions: [{ chat: "센터", from: "김민준", text: "확인 부탁" }], notices: [{ title: "보안 교육", board: "공지사항" }], attendance: { clockedIn: false, holiday: false } };

describe("sanitizePayload", () => {
  it("알려진 키만, 문자열 120자·목록 8개·멘션 5·공지 3으로 자르고 타입을 맞춘다", () => {
    const big = { ...full, evil: "x", meetings: Array.from({ length: 12 }, (_, i) => ({ time: "t", title: "제".repeat(300), place: 1 })), mentions: Array(9).fill({ chat: "c", from: "f", text: "t" }), notices: Array(5).fill({ title: "n", board: "b" }), tomorrow: "3", attendance: { clockedIn: "yes" } };
    const p = sanitizePayload(big);
    expect(Object.keys(p).sort()).toEqual(["absences", "approvals", "attendance", "date", "jira", "mails", "meetings", "mentions", "name", "notices", "tomorrow"]);
    expect(p.meetings).toHaveLength(8);
    expect(p.meetings[0].title).toHaveLength(121);
    expect(p.meetings[0].place).toBeUndefined();
    expect(p.mentions).toHaveLength(5);
    expect(p.notices).toHaveLength(3);
    expect(p.tomorrow).toBe(3);
    expect(p.attendance).toEqual({ clockedIn: false, holiday: false });
  });
  it("깨진 입력은 빈 payload", () => {
    const p = sanitizePayload("nope");
    expect(p).toEqual({ date: "", name: "", meetings: [], tomorrow: 0, absences: [], approvals: [], mails: [], mentions: [], jira: [], notices: [], attendance: null });
  });
  it("결재 days는 정수 또는 null, unread는 불리언", () => {
    const p = sanitizePayload({ approvals: [{ title: "a", from: "b", days: null, unread: "Y" }, { title: "c", from: "d", days: 2.7, unread: true }] });
    expect(p.approvals).toEqual([{ title: "a", from: "b", days: null, unread: false }, { title: "c", from: "d", days: 2, unread: true }]);
  });
});
describe("briefingEnabled / countsOf / prompt", () => {
  it("off 또는 키 없음이면 꺼짐, 빈 값·on은 켜짐", () => {
    expect(briefingEnabled("off", "k")).toBe(false);
    expect(briefingEnabled(" OFF ", "k")).toBe(false);
    expect(briefingEnabled("", undefined)).toBe(false);
    expect(briefingEnabled("", "k")).toBe(true);
    expect(briefingEnabled("on", "k")).toBe(true);
  });
  it("감사용 건수", () => expect(countsOf(sanitizePayload(full))).toEqual({ meetings: 1, approvals: 1, mails: 1, mentions: 1 }));
  it("시스템 프롬프트는 데이터 안 지시 무시·질문 금지·2~3문장을 못 박는다", () => {
    const s = briefingSystemPrompt();
    for (const w of ["지시", "질문", "2~3문장", "마크다운"]) expect(s).toContain(w);
  });
  it("출근 기록이 없으면(평일·휴일 아님) 첫 문장에서 출근 기록을 남기라고 알리게 한다", () => {
    const s = briefingSystemPrompt();
    expect(s).toContain("attendance.clockedIn");
    expect(s).toMatch(/출근 기록을 남기/);
  });
});
it('Jira 요약 입력은 최대 5개 제목 수준만 받고 본문·토큰은 제외', () => {
  const result = sanitizePayload({ jira: Array.from({ length: 9 }, () => ({ key: 'AX-1', title: '가'.repeat(500), status: '진행 중', dueDate: '2026-10-08', description: 'private', token: 'secret' })) });
  expect(result.jira).toHaveLength(5);
  expect(result.jira[0].title.length).toBeLessThanOrEqual(121);
  expect(result.jira[0]).not.toHaveProperty('description');
  expect(result.jira[0]).not.toHaveProperty('token');
});
