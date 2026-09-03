import { describe, expect, it } from "vitest";
import { fetchCommitsWindowed, isClaudeCommit, summarizeCommits } from "@/lib/work-metrics/gitlab";

describe("isClaudeCommit", () => {
  it("Claude Code 공동 저자 트레일러를 인식한다", () => {
    expect(isClaudeCommit("fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>")).toBe(true);
    expect(isClaudeCommit("feat: y\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>")).toBe(true);
    expect(isClaudeCommit("chore\n\nco-authored-by: claude opus <noreply@anthropic.com>")).toBe(true);
  });
  it("사람 공동 저자·트레일러 없음은 아니다", () => {
    expect(isClaudeCommit("fix: x\n\nCo-Authored-By: Kim <kim@innogrid.com>")).toBe(false);
    expect(isClaudeCommit("feat: claude 연동 문서")).toBe(false); // 제목에 단어만 있는 건 아님
    expect(isClaudeCommit(undefined)).toBe(false);
  });
});

describe("summarizeCommits", () => {
  it("authored_date(KST) 기준으로 묶고 Claude 경유를 따로 센다", () => {
    const out = summarizeCommits([
      { id: "a", author_email: "kim@innogrid.com", authored_date: "2026-08-31T23:30:00.000Z", committed_date: "2026-09-02T01:00:00.000Z", title: "t1", message: "t1\n\nCo-Authored-By: Claude <noreply@anthropic.com>" },
      { id: "b", author_email: "kim@innogrid.com", authored_date: "2026-08-31T23:40:00.000Z", committed_date: "2026-09-02T01:00:00.000Z", title: "t2", message: "t2" },
      { id: "c", author_email: "lee", authored_date: "2026-09-01T02:00:00.000Z", title: "t3", message: "t3" },
    ]);
    expect(out).toEqual(expect.arrayContaining([
      { day: "2026-09-01", email: "kim@innogrid.com", commits: 2, claude_commits: 1 },
      { day: "2026-09-01", email: "lee@innogrid.com", commits: 1, claude_commits: 0 },
    ]));
    expect(out).toHaveLength(2);
  });
  it("리베이스로 SHA만 바뀐 같은 커밋은 1건으로 센다", () => {
    const base = { author_email: "kim@innogrid.com", authored_date: "2026-08-20T01:00:00.000Z", title: "fix: same", message: "fix: same" };
    const out = summarizeCommits([
      { id: "old", ...base, committed_date: "2026-08-20T01:00:00.000Z" },
      { id: "rebased", ...base, committed_date: "2026-08-28T05:00:00.000Z" },
      { id: "other", ...base, title: "fix: different", committed_date: "2026-08-28T05:00:00.000Z" },
    ]);
    expect(out).toEqual([{ day: "2026-08-20", email: "kim@innogrid.com", commits: 2, claude_commits: 0 }]);
  });
  it("이메일·날짜 없는 커밋은 건너뛴다", () => {
    expect(summarizeCommits([{ id: "x", title: "no meta" }, { id: "y", author_email: "a b", authored_date: "2026-09-01T00:00:00Z" }, { id: "z", author_email: "kim", title: "no date" }])).toEqual([]);
  });
});

describe("fetchCommitsWindowed", () => {
  // all=true는 page를 무시하므로 한 창에서 최대 100건만 온다고 가정한 가짜 API
  const mk = (id: number, t: number) => ({ id: `sha${id}`, author_email: "kim@innogrid.com", authored_date: new Date(t).toISOString(), title: `c${id}` });
  const start = Date.parse("2026-08-01T00:00:00Z");
  const all = Array.from({ length: 450 }, (_, i) => mk(i, start + i * 3600_000)); // 1시간 간격 450건(≈19일)
  const calls: string[] = [];
  const fakeFetch = async (s: string, u: string) => {
    calls.push(`${s}~${u}`);
    const a = Date.parse(s), b = Date.parse(u);
    return all.filter((c) => { const t = Date.parse(c.authored_date); return t >= a && t <= b; }).slice(-100); // 최신 100건만
  };
  it("100건이 꽉 찬 창은 반으로 쪼개 전부 읽고 SHA 중복을 제거한다", async () => {
    calls.length = 0;
    const out = await fetchCommitsWindowed(fakeFetch, "2026-08-01T00:00:00Z", "2026-09-01T00:00:00Z");
    expect(new Set(out.map((c) => c.id)).size).toBe(450);
    expect(out).toHaveLength(450);
    expect(calls.length).toBeGreaterThan(5); // 한 번에 다 못 읽어 쪼갬
  });
  it("100건 미만이면 한 번만 요청한다", async () => {
    calls.length = 0;
    const out = await fetchCommitsWindowed(fakeFetch, "2026-08-01T00:00:00Z", "2026-08-02T00:00:00Z");
    expect(out).toHaveLength(25);
    expect(calls).toHaveLength(1);
  });
});
