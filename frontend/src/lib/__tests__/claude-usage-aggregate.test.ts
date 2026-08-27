import { describe, it, expect } from "vitest";
import { summarize, acceptRate, isIdleSeat, hasSeat, dateRangePreset } from "@/lib/claude-usage/aggregate";
import { emptyDailyMetrics, type DailyRow, type ModelRow } from "@/types/claude-usage";

const row = (p: Partial<DailyRow> & Pick<DailyRow, "day" | "org_id" | "user_email">): DailyRow => ({
  ...emptyDailyMetrics(), account_uuid: null, ...p,
});

describe("summarize", () => {
  const rows = [
    row({ day: "2026-08-24", org_id: "org-a", user_email: "dev1@example.com", sessions: 2, cost_usd: 1.5, input_tokens: 100, edits_accepted: 9, edits_rejected: 1 }),
    row({ day: "2026-08-25", org_id: "org-b", user_email: "dev1@example.com", sessions: 1, cost_usd: 0.5, commits: 1 }),
    row({ day: "2026-08-25", org_id: "org-a", user_email: "dev2@example.com", prompts: 3, cost_usd: 0 }),
    row({ day: "2026-08-25", org_id: "org-a", user_email: "dev3@example.com" }), // 활동 없음 → active 아님
  ];
  const models: ModelRow[] = [
    { day: "2026-08-24", org_id: "org-a", user_email: "dev1@example.com", model: "claude-opus-5", cost_usd: 1.5, input_tokens: 100, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
    { day: "2026-08-25", org_id: "org-b", user_email: "dev1@example.com", model: "claude-sonnet-5", cost_usd: 0.5, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0 },
  ];
  const orgs = [{ id: "org-a", name: "A", seats_total: 10, sort_order: 0 }, { id: "org-b", name: "B", seats_total: null, sort_order: 1 }];
  const members = [{ email: "dev1@example.com", name: "개발1", seat_tier: "Premium" }];

  it("사용자별 합산·조직 목록·활성일·이름 조인·정렬", () => {
    const s = summarize({ rows, models, orgs, members, from: "2026-08-23", to: "2026-08-25" });
    expect(s.users.map((u) => u.user_email)).toEqual(["dev1@example.com", "dev2@example.com", "dev3@example.com"]);
    expect(s.users[0]).toMatchObject({ orgs: ["org-a", "org-b"], sessions: 3, cost_usd: 2, active_days: 2, name: "개발1", seat_tier: "Premium", commits: 1 });
    expect(s.users[1]).toMatchObject({ active_days: 1, name: null, seat_tier: null });
    expect(s.users[2].active_days).toBe(0);
  });

  it("합계·일별 시리즈(빈 날 0)·모델별", () => {
    const s = summarize({ rows, models, orgs, members, from: "2026-08-23", to: "2026-08-25" });
    expect(s.totals).toMatchObject({ cost_usd: 2, sessions: 3, prompts: 3, active_users: 2 });
    expect(s.daily).toEqual([
      { day: "2026-08-23", cost_usd: 0, sessions: 0, active_users: 0 },
      { day: "2026-08-24", cost_usd: 1.5, sessions: 2, active_users: 1 },
      { day: "2026-08-25", cost_usd: 0.5, sessions: 1, active_users: 2 },
    ]);
    expect(s.models.map((m) => m.model)).toEqual(["claude-opus-5", "claude-sonnet-5"]);
    expect(s.orgs).toEqual(orgs);
    expect(s.range).toEqual({ from: "2026-08-23", to: "2026-08-25" });
  });

  it("이메일 조인은 대소문자 구분 없음 (user_email 유지)", () => {
    const mixedRows = [row({ day: "2026-08-25", org_id: "org-a", user_email: "Dev4@Example.com", sessions: 1, cost_usd: 0.1 })];
    const mixedMembers = [{ email: "dev4@example.com", name: "개발4", seat_tier: "Standard" }];
    const s = summarize({ rows: mixedRows, models: [], orgs, members: mixedMembers, from: "2026-08-25", to: "2026-08-25" });
    expect(s.users[0]).toMatchObject({ user_email: "Dev4@Example.com", name: "개발4", seat_tier: "Standard" });
  });

  it("CSV 이름이 빈 문자열이면 name은 null(UI가 이메일로 표시), 티어는 유지", () => {
    const rows = [{ ...emptyDailyMetrics(), org_id: "org-a", user_email: "noname@example.com", account_uuid: null, day: "2026-08-25", sessions: 1, cost_usd: 1 }];
    const s = summarize({ rows, models: [], orgs, members: [{ email: "noname@example.com", name: "  ", seat_tier: "Premium" }], from: "2026-08-25", to: "2026-08-25" });
    expect(s.users[0]).toMatchObject({ user_email: "noname@example.com", name: null, seat_tier: "Premium" });
  });
});

describe("acceptRate / isIdleSeat", () => {
  it("수락률과 노는 시트", () => {
    expect(acceptRate(9, 1)).toBe(90);
    expect(acceptRate(0, 0)).toBeNull();
    const base = { name: "", email: "x@example.com", role: "User", last_active: null, days_active: 0, messages: 0, projects_created: 0, projects_used: 0, pull_requests: 0, file_edits: 0, cowork_messages: 0, artifacts_created: 0, claude_code_artifacts: 0, cowork_artifacts: 0, estimated_spend_usd: 0 };
    expect(isIdleSeat({ ...base, seat_tier: "Premium", chats: 0, code_sessions: 0, cowork_sessions: 0 })).toBe(true);
    expect(isIdleSeat({ ...base, seat_tier: "Premium", chats: 0, code_sessions: 1, cowork_sessions: 0 })).toBe(false);
    expect(isIdleSeat({ ...base, seat_tier: "", chats: 0, code_sessions: 0, cowork_sessions: 0 })).toBe(false);
    expect(isIdleSeat({ ...base, seat_tier: "Unassigned", chats: 0, code_sessions: 0, cowork_sessions: 0 })).toBe(false);
  });

  it("hasSeat: 미할당 값(공백/대소문자 무관)은 시트 없음", () => {
    expect(hasSeat("Premium")).toBe(true);
    expect(hasSeat(" unassigned ")).toBe(false);
    expect(hasSeat(null)).toBe(false);
  });
});

describe("dateRangePreset", () => {
  // 2026-08-26 10:00 KST = 2026-08-26T01:00:00Z
  const today = new Date("2026-08-26T01:00:00Z");
  it("KST 기준 프리셋", () => {
    expect(dateRangePreset("7d", today)).toEqual({ from: "2026-08-20", to: "2026-08-26" });
    expect(dateRangePreset("30d", today)).toEqual({ from: "2026-07-28", to: "2026-08-26" });
    expect(dateRangePreset("90d", today)).toEqual({ from: "2026-05-29", to: "2026-08-26" });
    expect(dateRangePreset("thisMonth", today)).toEqual({ from: "2026-08-01", to: "2026-08-26" });
    expect(dateRangePreset("lastMonth", today)).toEqual({ from: "2026-07-01", to: "2026-07-31" });
    // 1월 → 전년 12월 (KST 2026-01-15 10:00 = 2026-01-15T01:00:00Z)
    expect(dateRangePreset("lastMonth", new Date("2026-01-15T01:00:00Z"))).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});
