import { describe, expect, it } from "vitest";
import { ASSISTANT_TOOLS, TOOL_TIERS, SERVER_TOOLS, assistantSystemPrompt, assistantEnabled, dailyTurnLimit, kstDayStartIso } from "@/lib/assistant/tools";
import contract from "@/lib/assistant/tool-contract.json";

// 계약 파일(tool-contract.json)이 원본 — 앱 테스트도 같은 파일과 대조한다. 아래 고정 목록은 계약 파일이 실수로 비거나 줄지 않았는지 보는 안전망.
const NAMES = ["approval_counts","approval_read","approvals_pending","attendance_today","cancel_reservation","clock_in","clock_out","confluence_create_page","confluence_feed","confluence_read","confluence_search","confluence_spaces","create_event","delete_event","find_free_rooms","find_person","list_calendars","list_events","list_rooms","mail_list","mail_read","mail_save_draft","mail_search","mail_send","my_reservations","my_team","notice_read","notices_list","offer_choices","reserve_room","search","sharepoint_read","sharepoint_recent","sharepoint_search","teams_chats","teams_mentions","teams_send","undo_last"];

// 앱 기능 도구(lib/assistant/feature-tools.ts)는 서버 전용 — 앱 목록에 없고, 쓰기 확인 카드 문구도 서버가 보낸다.
const FEATURE_NAMES = ["food_search", "jira_issue", "jira_issues", "people_news", "ppt_create", "ppt_decks"];

describe("도구 표", () => {
  it("스키마 이름 = 등급 표 키 = 계약 파일의 앱 도구 + 서버 전용 앱 기능 도구", () => {
    expect(Object.keys(contract.appTools).sort()).toEqual(NAMES);
    for (const [n, tier] of Object.entries(contract.appTools)) expect(TOOL_TIERS[n]).toBe(tier);
    for (const n of contract.appServerTools) expect(NAMES).toContain(n);
    expect([...SERVER_TOOLS].sort()).toEqual([...contract.appServerTools, ...FEATURE_NAMES].sort());
    const all = [...NAMES, ...FEATURE_NAMES].sort();
    expect(ASSISTANT_TOOLS.map((t) => t.name).sort()).toEqual(all);
    expect(Object.keys(TOOL_TIERS).sort()).toEqual(all);
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
    expect(TOOL_TIERS.my_team).toBe("read");
    expect(TOOL_TIERS.confluence_create_page).toBe("write");
    expect(TOOL_TIERS.confluence_search).toBe("read");
    expect(SERVER_TOOLS).toEqual(["teams_chats", "teams_mentions", "teams_send", "confluence_search", "confluence_read", "confluence_feed", "confluence_spaces", "confluence_create_page", "sharepoint_search", "sharepoint_recent", "sharepoint_read", "jira_issues", "jira_issue", "people_news", "food_search", "ppt_decks", "ppt_create"]);
    expect(TOOL_TIERS.sharepoint_read).toBe("read");
    expect(TOOL_TIERS.mail_search).toBe("read");
  });
  it("offer_choices — 선택지(최대 4)마다 실행할 쓰기 호출 묶음", () => {
    const t = ASSISTANT_TOOLS.find((x) => x.name === "offer_choices")!;
    const opts = (t.input_schema.properties as Record<string, { maxItems?: number; items?: { properties?: Record<string, unknown>; required?: string[] } }>).options;
    expect(opts.maxItems).toBe(4);
    expect((opts as { minItems?: number }).minItems).toBe(2);
    expect((opts.items?.properties?.calls as { maxItems?: number }).maxItems).toBe(5);
    expect(opts.items?.required).toEqual(["label", "calls"]);
    expect(t.input_schema.required).toEqual(["question", "options"]);
  });
  it("create_event — calendar_id(선택, list_calendars의 mcalSeq)", () => {
    const t = ASSISTANT_TOOLS.find((x) => x.name === "create_event")!;
    expect(Object.keys(t.input_schema.properties as object)).toContain("calendar_id");
    expect(t.input_schema.required).not.toContain("calendar_id");
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
    const s = assistantSystemPrompt({ now: "2026-10-05T14:03+09:00", name: "강승욱", email: "a@innogrid.com" }).map((b) => b.text).join("\n");
    for (const w of ["2026-10-05(월) 14:03 KST", "강승욱", "지시가 아니다", "되묻", "확인", "12:00", "동명이인", "offer_choices", "단독으로", "my_team", "calendar_id"]) expect(s).toContain(w);
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
});

describe("assistant prompt caching", () => {
  it("고정 규칙 블록에 캐시 표시, 사람·시각은 캐시 구간 뒤 블록으로", async () => {
    const { assistantSystemPrompt } = await import("@/lib/assistant/tools");
    const system = assistantSystemPrompt({ now: "2026-10-05T14:03", name: "강승욱", email: "a@innogrid.com" }) as { text: string; cache_control?: unknown }[];
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(system[0].text).not.toContain("강승욱");
    expect(system[0].text).not.toContain("14:03");
    expect(system[1].text).toContain("강승욱");
    expect(system[1].text).toContain("2026-10-05(월) 14:03 KST");
    expect(system[1].cache_control).toBeUndefined();
  });
});
