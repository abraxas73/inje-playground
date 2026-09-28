import { describe, expect, it } from "vitest";
import { deriveFreshness, type SyncLogRow } from "@/lib/work-metrics/freshness";

const now = new Date("2026-09-28T01:00:00Z");
const row = (source: string, created_at: string, ok = true, error: string | null = null): SyncLogRow => ({ source, range_to: created_at.slice(0, 10), ok, error, created_at });

describe("deriveFreshness", () => {
  it("기록이 전혀 없으면 세 소스 모두 없음·오래됨", () => {
    const f = deriveFreshness([], now);
    expect(f.jira).toEqual({ lastOkAt: null, rangeTo: null, lastError: null, stale: true });
    expect(f.gitlab.stale).toBe(true);
    expect(f.confluence.stale).toBe(true);
  });
  it("최근 성공이 48시간 안이면 신선, 넘으면 오래됨", () => {
    const f = deriveFreshness([row("jira", "2026-09-27T22:30:00Z"), row("gitlab", "2026-09-25T22:45:00Z")], now);
    expect(f.jira).toMatchObject({ lastOkAt: "2026-09-27T22:30:00Z", rangeTo: "2026-09-27", stale: false, lastError: null });
    expect(f.gitlab.stale).toBe(true);
  });
  it("최신 기록이 실패면 오류를 싣고, 마지막 성공은 그 전 성공 행이다", () => {
    const f = deriveFreshness([row("jira", "2026-09-27T22:30:00Z"), row("jira", "2026-09-28T00:30:00Z", false, "Jira 401")], now);
    expect(f.jira).toEqual({ lastOkAt: "2026-09-27T22:30:00Z", rangeTo: "2026-09-27", lastError: "Jira 401", stale: false });
  });
  it("정렬되지 않은 입력·다른 소스(gitlab_items)는 무시한다", () => {
    const f = deriveFreshness([row("gitlab", "2026-09-26T22:45:00Z"), row("gitlab", "2026-09-27T22:45:00Z"), row("gitlab_items", "2026-09-27T23:00:00Z")], now);
    expect(f.gitlab.lastOkAt).toBe("2026-09-27T22:45:00Z");
  });
});
