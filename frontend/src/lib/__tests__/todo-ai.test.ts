import { describe, expect, it } from "vitest";
import { analyzeTodo, buildReviewStats, extractJson, kstDayStartIso, kstToday, normalizeAnalysis } from "@/lib/todo/ai";
import { canUsePage, pagesForPath } from "@/lib/page-access";
import { auditCategoryFor } from "@/lib/audit-proxy";
import { DASHBOARD_WIDGET_IDS } from "@/lib/home-dashboard";

describe("할 일 AI", () => {
  it("분석 정규화 — 우선순위 기본 p3, 태그는 @ 붙인 소문자 4개까지, 시간대 없는 일시는 KST, 1주 넘는 시간은 버림", () => {
    expect(normalizeAnalysis({ title: " 보고서 ", scheduled_for: "2026-11-03T15:00:00", estimated_minutes: 30.7, priority: "P1", context_tags: ["Office", "@computer", "office", "a b", "x", "y"] }, "원문")).toEqual({
      title: "보고서", scheduled_for: "2026-11-03T06:00:00.000Z", estimated_minutes: 30, priority: "p1", context_tags: ["@office", "@computer", "@ab", "@x"],
    });
    expect(normalizeAnalysis({ title: "", priority: "zz", estimated_minutes: 99999, scheduled_for: "아무때나" }, "원문 그대로")).toEqual({
      title: "원문 그대로", scheduled_for: null, estimated_minutes: null, priority: "p3", context_tags: [],
    });
    expect(normalizeAnalysis([], "x")).toBeNull();
  });

  it("JSON은 코드펜스·앞뒤 말이 있어도 객체만 읽는다", () => {
    expect(extractJson('```json\n{"title":"a"}\n```')).toEqual({ title: "a" });
    expect(() => extractJson("없음")).toThrow();
  });

  it("오늘 날짜는 KST — UTC 16시는 한국 다음 날", () => {
    expect(kstToday(new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-02");
    expect(kstDayStartIso(new Date("2026-11-01T16:00:00Z"))).toBe("2026-11-01T15:00:00.000Z"); // 하루 상한은 KST 0시부터 센다
  });

  it("analyzeTodo는 오늘 날짜를 넣어 한 번 부르고 생각을 끈다", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = { messages: { create: async (req: Record<string, unknown>) => { calls.push(req); return { stop_reason: "end_turn", content: [{ type: "text", text: '{"title":"전화","priority":"p2","context_tags":["phone"]}' }] }; } } };
    const r = await analyzeTodo("내일 전화", { client: client as never, now: new Date("2026-11-02T00:00:00Z") });
    expect(r).toMatchObject({ title: "전화", priority: "p2", context_tags: ["@phone"] });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].messages)).toContain("2026-11-02");
    expect(calls[0].thinking).toEqual({ type: "between_tools" });
  });

  it("주간 통계 — 7일 안 완료만 우선순위로 세고, 진행 중은 open, 2회 이상 이월은 제목 5개까지", () => {
    const since = "2026-10-26T00:00:00.000Z";
    const rows = [
      { state: "done", priority: "p1", context_tags: ["@office"], migration_count: 0, title: "a", completed_at: "2026-10-30T00:00:00Z" },
      { state: "done", priority: "p2", context_tags: ["@office", "@home"], migration_count: 0, title: "b", completed_at: "2026-10-01T00:00:00Z" },
      { state: "in_progress", priority: "p3", context_tags: null, migration_count: 3, title: "미룬 일", completed_at: null },
      { state: "cancelled", priority: "p4", context_tags: [], migration_count: 0, title: "c", completed_at: null },
    ];
    expect(buildReviewStats(rows, since)).toEqual({ done: 1, open: 1, migrated: 1, by_priority: { p1: 1, p2: 0, p3: 0, p4: 0 }, top_tags: ["@office", "@home"], carryover_titles: ["미룬 일"] });
  });

  it("/api/todo는 todo 권한, 감사 분류는 todo, 홈 위젯 id에 todo", () => {
    expect(pagesForPath("/api/todo/analyze")).toEqual(["todo"]);
    expect(canUsePage("user", "todo", { todo: false })).toBe(false);
    expect(canUsePage("guest", "todo")).toBe(false);
    expect(auditCategoryFor("/api/todo/analyze")).toBe("todo");
    expect(DASHBOARD_WIDGET_IDS).toContain("todo");
  });
});
