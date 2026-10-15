import { expect, it } from "vitest";
import { aggregateUsage, type UsageRow } from "@/lib/chat/usage-report";

it("사용자별 합계·Opus 턴·팀 합계(팀 없으면 '미지정'), 턴 많은 순", () => {
  const rows: UsageRow[] = [
    { user_id: "u1", day: "2026-10-14", turns: 3, input_tokens: 100, output_tokens: 10, model_turns: { "claude-sonnet-5-5": 2, "claude-opus-5-5": 1 }, masked: 1 },
    { user_id: "u1", day: "2026-10-15", turns: 2, input_tokens: 50, output_tokens: 5, model_turns: { "claude-opus-5-5": 2 }, masked: 0 },
    { user_id: "u2", day: "2026-10-15", turns: 9, input_tokens: 900, output_tokens: 90, model_turns: { "claude-sonnet-5-5": 9 }, masked: 2 },
  ];
  const people = new Map([["u1", { name: "가", email: "a@x" }], ["u2", { name: "나", email: "b@x" }]]);
  const r = aggregateUsage(rows, people, new Map([["a@x", "플랫폼팀"]]));
  expect(r.users.map((u) => [u.name, u.turns, u.opusTurns, u.team])).toEqual([["나", 9, 0, "미지정"], ["가", 5, 3, "플랫폼팀"]]);
  expect(r.teams).toEqual([{ team: "미지정", users: 1, turns: 9, inputTokens: 900, outputTokens: 90 }, { team: "플랫폼팀", users: 1, turns: 5, inputTokens: 150, outputTokens: 15 }]);
});
