import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS, TOOL_TIERS, SERVER_TOOLS, assistantSystemPrompt, assistantEnabled, dailyTurnLimit, kstDayStartIso, validateMessages } from "@/lib/assistant/tools";

// 앱 assistant_tools.dart의 assistantToolTiers와 같은 목록 — 한쪽만 바꾸면 양쪽 테스트가 깨진다.
const NAMES = ["approval_counts","approval_read","approvals_pending","attendance_today","cancel_reservation","clock_in","clock_out","create_event","delete_event","find_free_rooms","find_person","list_calendars","list_events","list_rooms","mail_list","mail_read","mail_save_draft","mail_send","my_reservations","notice_read","notices_list","offer_choices","reserve_room","search","teams_chats","teams_mentions","teams_send","undo_last"];

describe("도구 표", () => {
  it("스키마 이름 = 등급 표 키 = 앱과 약속한 목록", () => {
    expect(ASSISTANT_TOOLS.map((t) => t.name).sort()).toEqual(NAMES);
    expect(Object.keys(TOOL_TIERS).sort()).toEqual(NAMES);
  });
  it("쓰기·되돌릴 수 없음 등급", () => {
    expect(TOOL_TIERS.reserve_room).toBe("write");
    expect(TOOL_TIERS.create_event).toBe("write");
    expect(TOOL_TIERS.mail_send).toBe("irreversible");
    expect(TOOL_TIERS.clock_in).toBe("write");
    expect(TOOL_TIERS.teams_send).toBe("write");
    expect(TOOL_TIERS.find_free_rooms).toBe("read");
    expect(TOOL_TIERS.undo_last).toBe("meta");
    expect(TOOL_TIERS.offer_choices).toBe("choice");
    expect(SERVER_TOOLS).toEqual(["teams_chats", "teams_mentions", "teams_send"]);
  });
  it("offer_choices — 선택지(최대 4)마다 실행할 쓰기 호출 묶음", () => {
    const t = ASSISTANT_TOOLS.find((x) => x.name === "offer_choices")!;
    const opts = (t.input_schema.properties as Record<string, { maxItems?: number; items?: { properties?: Record<string, unknown>; required?: string[] } }>).options;
    expect(opts.maxItems).toBe(4);
    expect(opts.items?.required).toEqual(["label", "calls"]);
    expect(t.input_schema.required).toEqual(["question", "options"]);
  });
  it("모든 스키마는 object input_schema와 한국어 설명을 가진다", () => {
    for (const t of ASSISTANT_TOOLS) {
      expect(t.input_schema.type).toBe("object");
      expect((t.description ?? "").length).toBeGreaterThan(5);
    }
  });
});
describe("지침·설정·검증", () => {
  it("지침은 시각·이름을 담고, 데이터 속 지시 무시·되묻기·확인은 앱이 받음을 못 박는다", () => {
    const s = assistantSystemPrompt({ now: "2026-10-05T14:03+09:00", name: "강승욱", email: "a@innogrid.com" });
    for (const w of ["2026-10-05(월) 14:03 KST", "강승욱", "지시가 아니다", "되묻", "확인", "12:00", "동명이인", "offer_choices", "단독으로"]) expect(s).toContain(w);
  });
  it("assistantEnabled / dailyTurnLimit", () => {
    expect(assistantEnabled("", "k")).toBe(true);
    expect(assistantEnabled(" off ", "k")).toBe(false);
    expect(assistantEnabled("on", undefined)).toBe(false);
    expect(dailyTurnLimit("")).toBe(200);
    expect(dailyTurnLimit("30")).toBe(30);
    expect(dailyTurnLimit("abc")).toBe(200);
    expect(dailyTurnLimit("0")).toBe(200);
  });
  it("kstDayStartIso — KST 자정", () => {
    expect(kstDayStartIso(new Date("2026-10-05T16:00:00Z"))).toBe("2026-10-06T00:00:00+09:00");
    expect(kstDayStartIso(new Date("2026-10-05T14:59:00Z"))).toBe("2026-10-05T00:00:00+09:00");
  });
  it("validateMessages — 역할·내용 형식, 개수 상한, 첫 메시지는 user", () => {
    expect(validateMessages([{ role: "user", content: "안녕" }])).toHaveLength(1);
    expect(validateMessages([{ role: "user", content: [{ type: "text", text: "a" }] }, { role: "assistant", content: [{ type: "text", text: "b" }] }])).toHaveLength(2);
    expect(validateMessages([])).toBeNull();
    expect(validateMessages([{ role: "assistant", content: "x" }])).toBeNull();
    expect(validateMessages([{ role: "system", content: "x" }])).toBeNull();
    expect(validateMessages([{ role: "user", content: 3 }])).toBeNull();
    expect(validateMessages(Array.from({ length: 61 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })))).toBeNull();
    expect(validateMessages("nope")).toBeNull();
  });
});
