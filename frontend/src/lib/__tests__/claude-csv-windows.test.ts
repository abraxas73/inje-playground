import { describe, expect, it } from "vitest";
import { mergeWindowRows, pickWindowImports, windowTargets } from "@/lib/claude-usage/csv-windows";
import type { MemberActivityRow } from "@/types/claude-usage";

const imp = (org_id: string, period_end: string, id = `${org_id}-${period_end}`) => ({ id, org_id, period_start: "x", period_end });

describe("windowTargets", () => {
  it("종료일에서 30일씩 거슬러 간다", () => {
    expect(windowTargets("2026-09-28", 3)).toEqual(["2026-09-28", "2026-08-29", "2026-07-30"]);
    expect(windowTargets("2026-03-02", 2)).toEqual(["2026-03-02", "2026-01-31"]);
  });
});

describe("pickWindowImports", () => {
  const all = [imp("a", "2026-09-28"), imp("a", "2026-09-27"), imp("a", "2026-08-30"), imp("b", "2026-09-28"), imp("b", "2026-08-25")];
  it("창마다 조직별로 목표일에 가장 가까운(±3일) 수집을 고르고, 없으면 빈 창", () => {
    const w = pickWindowImports(all, "2026-09-28", 3);
    expect(w.map((x) => x.target)).toEqual(["2026-09-28", "2026-08-29", "2026-07-30"]);
    expect(w[0].imports.map((i) => i.id).sort()).toEqual(["a-2026-09-28", "b-2026-09-28"]);
    expect(w[1].imports.map((i) => i.id)).toEqual(["a-2026-08-30"]); // b의 08-25는 4일 밖
    expect(w[2].imports).toEqual([]);
  });
  it("같은 period_end가 여러 번 업로드됐으면 입력 순서상 먼저 온 것(최신 업로드)을 쓴다", () => {
    const dup = [imp("a", "2026-09-28", "new"), imp("a", "2026-09-28", "old")];
    expect(pickWindowImports(dup, "2026-09-28", 1)[0].imports.map((i) => i.id)).toEqual(["new"]);
  });
});

describe("mergeWindowRows", () => {
  const row = (email: string, chats: number, extra: Partial<MemberActivityRow & { org_id: string; import_id: string }> = {}) => ({
    org_id: "a", import_id: "i", name: email, email, role: "User", seat_tier: "Standard", last_active: "2026-09-01", days_active: 1,
    chats, messages: chats * 2, projects_created: 0, projects_used: 0, pull_requests: 0, code_sessions: 0, file_edits: 0,
    cowork_sessions: 0, cowork_messages: 0, unified_messages: 0, artifacts_created: 0, claude_code_artifacts: 0, cowork_artifacts: 0, estimated_spend_usd: 1.5, ...extra,
  });
  it("조직·이메일별로 숫자를 더하고, 이름·티어는 최신 창, last_active는 최댓값", () => {
    const latest = [row("k@x", 3, { seat_tier: "Unassigned", last_active: "2026-09-20" })];
    const older = [row("k@x", 5, { seat_tier: "Standard", last_active: "2026-08-20", import_id: "old" }), row("m@x", 1, { org_id: "b" })];
    const out = mergeWindowRows([latest, older]).sort((p, q) => (p.email < q.email ? -1 : 1));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ email: "k@x", chats: 8, messages: 16, days_active: 2, estimated_spend_usd: 3, seat_tier: "Unassigned", last_active: "2026-09-20", import_id: "i" });
    expect(out[1]).toMatchObject({ email: "m@x", org_id: "b", chats: 1 });
  });
  it("창이 하나면 그대로", () => {
    const one = [row("k@x", 2)];
    expect(mergeWindowRows([one])).toEqual(one);
  });
});
