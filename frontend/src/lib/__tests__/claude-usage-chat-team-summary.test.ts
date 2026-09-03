import { describe, expect, it } from "vitest";
import { aggregateChatTeams, parentUnitOf } from "@/lib/claude-usage/chat-team-summary";

const base = { chats: 0, messages: 0, code_sessions: 0, cowork_sessions: 0, cowork_messages: 0, projects_used: 0, artifacts_created: 0, estimated_spend_usd: 0 };

describe("aggregateChatTeams", () => {
  it("팀별로 수치를 더하고 인원은 고유 이메일로 센다(여러 Claude 조직 계정 중복 제거)", () => {
    const rows = aggregateChatTeams([
      { ...base, email: "a@x.com", days_active: 5, messages: 100, chats: 3, team: "T", parent_unit: "C" },
      { ...base, email: "A@x.com", days_active: 0, messages: 20, chats: 1, team: "T", parent_unit: "C" }, // 같은 사람, 다른 조직
      { ...base, email: "b@x.com", days_active: 0, team: "T", parent_unit: "C" },
      { ...base, email: "c@x.com", days_active: 1, messages: 7, team: null },
    ]);
    const t = rows.find((r) => r.team === "T")!;
    expect(t).toMatchObject({ parent: "C", users: 2, active_users: 1, messages: 120, chats: 4 });
    expect(rows.find((r) => r.team === "명부 없음")).toMatchObject({ users: 1, active_users: 1, messages: 7, parent: null });
  });
});

describe("parentUnitOf", () => {
  it("팀 바로 위 단위(센터)를 우선, 없으면 본부·부문", () => {
    expect(parentUnitOf({ team: "UI.UX디자인팀", parent_unit: "디자인센터", headquarters: "R&D본부" })).toBe("디자인센터");
    expect(parentUnitOf({ team: "팀", parent_unit: null, headquarters: "본부" })).toBe("본부");
    expect(parentUnitOf({ team: "본부직속", parent_unit: "본부직속", headquarters: "본부직속", division: "부문" })).toBe("부문");
    expect(parentUnitOf({ team: null })).toBeNull();
  });
});
