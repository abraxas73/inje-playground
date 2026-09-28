import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitItemKey, jiraIssueItem, mrItemKey, normalizeGitlabItem } from "@/lib/work-metrics/items";

const id = (e: string) => e;

describe("keys", () => {
  it("커밋 키는 이메일|authored|제목의 md5 — 일 집계 중복 제거 규칙과 같은 조합", () => {
    const k = commitItemKey("kim@innogrid.com", "2026-09-01T02:00:00.000Z", "fix: x");
    expect(k).toBe(createHash("md5").update("kim@innogrid.com|2026-09-01T02:00:00.000Z|fix: x").digest("hex"));
    expect(mrItemKey("grp/app", 12)).toBe("grp/app!12");
  });
});

describe("jiraIssueItem", () => {
  it("시각을 ISO로 정규화하고 In Progress 없는 이슈는 started_at null", () => {
    const it1 = jiraIssueItem({ key: "CMP-1", project: "CMP", email: "kim@innogrid.com", created: "2026-09-01T09:00:00.000+0900", started: null, resolved: "2026-09-02T09:00:00.000+0900", storyPoints: 3 });
    expect(it1).toEqual({ source: "jira", kind: "issue", item_key: "CMP-1", user_email: "kim@innogrid.com", scope_key: "CMP", created_at: "2026-09-01T00:00:00.000Z", started_at: null, done_at: "2026-09-02T00:00:00.000Z", story_points: 3, is_claude: false });
    expect(jiraIssueItem({ key: "CMP-2", project: "CMP", email: "kim@innogrid.com", created: "2026-09-01T09:00:00.000+0900", started: "2026-09-01T10:00:00.000+0900", resolved: "2026-09-02T09:00:00.000+0900", storyPoints: null }).started_at).toBe("2026-09-01T01:00:00.000Z");
  });
});

describe("normalizeGitlabItem", () => {
  const base = { kind: "mr", item_key: "grp/app!1", user_email: "Kim@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00Z", done_at: "2026-09-02T00:00:00Z" };
  it("정상 행은 ISO·소문자·이메일 정규화 함수를 거친다", () => {
    const out = normalizeGitlabItem(base, (e) => (e === "kim@innogrid.com" ? "kim.s@innogrid.com" : e));
    expect(out).toEqual({ source: "gitlab", kind: "mr", item_key: "grp/app!1", user_email: "kim.s@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00.000Z", started_at: null, done_at: "2026-09-02T00:00:00.000Z", story_points: null, is_claude: false });
  });
  it("done_at이 created_at보다 앞서면 created_at으로 보정한다", () => {
    expect(normalizeGitlabItem({ ...base, done_at: "2026-08-31T00:00:00Z" }, id)?.done_at).toBe("2026-09-01T00:00:00.000Z");
  });
  it("kind·키·이메일·scope·created_at이 잘못되면 null", () => {
    expect(normalizeGitlabItem({ ...base, kind: "issue" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, item_key: "" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, item_key: "x".repeat(201) }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, user_email: "ab" }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, scope_key: " " }, id)).toBeNull();
    expect(normalizeGitlabItem({ ...base, created_at: "not a date" }, id)).toBeNull();
  });
  it("is_claude는 true일 때만 true, 커밋은 done_at 없음", () => {
    const c = normalizeGitlabItem({ kind: "commit", item_key: "abc", user_email: "kim@innogrid.com", scope_key: "grp/app", created_at: "2026-09-01T00:00:00Z", is_claude: "yes" }, id);
    expect(c).toMatchObject({ kind: "commit", is_claude: false, done_at: null, started_at: null });
  });
  it("객체가 아닌 행(null·문자열·배열)은 예외 없이 null", () => {
    expect(normalizeGitlabItem(null, id)).toBeNull();
    expect(normalizeGitlabItem("x", id)).toBeNull();
    expect(normalizeGitlabItem([base], id)).toBeNull();
  });
});
