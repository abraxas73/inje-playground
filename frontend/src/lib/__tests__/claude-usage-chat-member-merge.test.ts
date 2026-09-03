import { describe, expect, it } from "vitest";
import { mergeMembersByEmail, MEMBER_SUM_FIELDS, type MergeableMemberRow } from "@/lib/claude-usage/chat-member-merge";

const zero = Object.fromEntries(MEMBER_SUM_FIELDS.map((f) => [f, 0])) as Record<(typeof MEMBER_SUM_FIELDS)[number], number>;
const row = (over: Partial<MergeableMemberRow> & { email: string }): MergeableMemberRow => ({ ...zero, last_active: null, days_active: 0, ...over });

describe("mergeMembersByEmail", () => {
  it("여러 Claude 조직의 같은 이메일 행을 한 줄로 — 활동은 합, 활동일·마지막 활동은 최댓값", () => {
    const merged = mergeMembersByEmail([
      row({ email: "a@x.com", days_active: 5, last_active: "2026-08-20", chats: 3, messages: 100, estimated_spend_usd: 1.5, seat_tier: "Unassigned" }),
      row({ email: "A@x.com", days_active: 2, last_active: "2026-08-28", chats: 1, messages: 20, estimated_spend_usd: 0.5, seat_tier: "Team Premium" }),
      row({ email: "b@x.com", days_active: 1, chats: 1 }),
    ]);
    expect(merged).toHaveLength(2);
    const a = merged.find((m) => m.email.toLowerCase() === "a@x.com")!;
    expect(a).toMatchObject({ days_active: 5, last_active: "2026-08-28", chats: 4, messages: 120, estimated_spend_usd: 2 });
  });

  it("시트는 배정된 쪽을 남기고, Claude Code 프롬프트는 더하지 않고 최댓값(이메일 단위 값)", () => {
    const [a] = mergeMembersByEmail([
      row({ email: "a@x.com", seat_tier: "Unassigned", code_prompts: 120, code_prompts_auto: 30 }),
      row({ email: "a@x.com", seat_tier: "Team Standard", code_prompts: 120, code_prompts_auto: 30 }),
    ]);
    expect(a.seat_tier).toBe("Team Standard");
    expect(a.code_prompts).toBe(120);
    expect(a.code_prompts_auto).toBe(30);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const src = [row({ email: "a@x.com", chats: 1 }), row({ email: "a@x.com", chats: 2 })];
    mergeMembersByEmail(src);
    expect(src[0].chats).toBe(1);
  });
});
