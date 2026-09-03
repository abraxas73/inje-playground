import { describe, expect, it } from "vitest";
import { aggregateCodeTeams, CODE_TEAM_SUM_FIELDS, type CodeMemberLike } from "@/lib/claude-usage/code-team-summary";

const zero = Object.fromEntries(CODE_TEAM_SUM_FIELDS.map((f) => [f, 0])) as Record<(typeof CODE_TEAM_SUM_FIELDS)[number], number>;
const member = (over: Partial<CodeMemberLike> & { email: string }): CodeMemberLike => ({ ...zero, ...over });

describe("aggregateCodeTeams", () => {
  it("팀별로 수치를 더하고 인원·활동자는 고유 이메일로 센다", () => {
    const rows = aggregateCodeTeams([
      member({ email: "a@x.com", team: "T", parent_unit: "C", cost_usd: 10, sessions: 3, prompts: 40, prompts_auto: 10, commits: 2 }),
      member({ email: "A@x.com", team: "T", parent_unit: "C", cost_usd: 5, sessions: 0, prompts: 1, prompts_auto: 0 }), // 같은 사람(대소문자)
      member({ email: "b@x.com", team: "T", parent_unit: "C" }), // 기간 내 사용 없음 → 인원에만 포함
      member({ email: "c@x.com", team: null, sessions: 1 }),
    ]);
    const t = rows.find((r) => r.team === "T")!;
    expect(t).toMatchObject({ parent: "C", users: 2, active_users: 1, cost_usd: 15, sessions: 3, prompts: 41, prompts_auto: 10, commits: 2 });
    expect(rows.find((r) => r.team === "명부 없음")).toMatchObject({ users: 1, active_users: 1, parent: null });
  });

  it("상위 조직은 parent_unit → 본부 → 부문 순으로 고르고 팀과 같으면 비운다", () => {
    const [hq] = aggregateCodeTeams([member({ email: "a@x.com", team: "팀", headquarters: "본부" })]);
    expect(hq.parent).toBe("본부");
    const [same] = aggregateCodeTeams([member({ email: "b@x.com", team: "본부직속", headquarters: "본부직속", division: "부문" })]);
    expect(same.parent).toBe("부문");
  });

  it("비용은 0이지만 세션이 있으면 활동자로 센다", () => {
    const [t] = aggregateCodeTeams([member({ email: "a@x.com", team: "T", sessions: 2 })]);
    expect(t.active_users).toBe(1);
  });
});
