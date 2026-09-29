// frontend/src/lib/__tests__/claude-seat-actions.test.ts
import { describe, expect, it } from "vitest";
import { canTransition, checkRequest, executorState, overlaySeat, parseRequest, summarize } from "@/lib/claude-usage/seat-actions";
import type { SeatAction } from "@/types/claude-seat";

const base: SeatAction = {
  id: "a1", org_id: "org-1", email: "kim@innogrid.com", action: "unassign", target_tier: null, status: "requested",
  requested_by: "u1", requested_by_email: "admin@innogrid.com", requested_at: "2026-09-29T01:00:00.000Z",
  started_at: null, finished_at: null, before_tier: null, after_tier: null, error: null, executor: null,
};
const now = new Date("2026-09-29T02:00:00.000Z");

describe("parseRequest", () => {
  it("이메일은 소문자·trim, action·target_tier 검증", () => {
    expect(parseRequest({ org_id: " Org-1 ", email: " Kim@Innogrid.com ", action: "unassign" })).toEqual({ ok: true, value: { org_id: "org-1", email: "kim@innogrid.com", action: "unassign", target_tier: null } });
    expect(parseRequest({ org_id: "org-1", email: "kim@innogrid.com", action: "assign", target_tier: "Premium" })).toEqual({ ok: true, value: { org_id: "org-1", email: "kim@innogrid.com", action: "assign", target_tier: "Premium" } });
  });
  it("잘못된 본문은 오류 문구", () => {
    expect(parseRequest(null).ok).toBe(false);
    expect(parseRequest({ org_id: "org-1", email: "nope", action: "unassign" })).toEqual({ ok: false, error: "org_id와 이메일이 필요합니다." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "delete" })).toEqual({ ok: false, error: "action은 unassign 또는 assign이어야 합니다." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "assign" })).toEqual({ ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." });
    expect(parseRequest({ org_id: "org-1", email: "a@b.c", action: "assign", target_tier: "Gold" })).toEqual({ ok: false, error: "할당 티어(Standard 또는 Premium)를 고르세요." });
  });
});

describe("checkRequest", () => {
  const un = { org_id: "org-1", email: "kim@innogrid.com", action: "unassign" as const, target_tier: null };
  const as = { ...un, action: "assign" as const, target_tier: "Standard" as const };
  it("활성 멤버가 아니면 404, 대기 요청 있으면 409", () => {
    expect(checkRequest(un, null, false)).toEqual({ status: 404, error: "이 조직의 활성 멤버가 아닙니다." });
    expect(checkRequest(un, { status: "pending", seat_tier: "Standard" }, false)).toEqual({ status: 404, error: "이 조직의 활성 멤버가 아닙니다." });
    expect(checkRequest(un, { status: "active", seat_tier: "Standard" }, true)).toEqual({ status: 409, error: "이미 대기·실행 중인 요청이 있습니다." });
  });
  it("해제는 시트가 있어야, 할당은 미할당이어야 한다", () => {
    expect(checkRequest(un, { status: "active", seat_tier: "Unassigned" }, false)).toEqual({ status: 400, error: "이미 미할당입니다." });
    expect(checkRequest(un, { status: "active", seat_tier: "Premium" }, false)).toBeNull();
    expect(checkRequest(as, { status: "active", seat_tier: "Premium" }, false)).toEqual({ status: 400, error: "이미 시트가 있습니다(Premium)." });
    expect(checkRequest(as, { status: "active", seat_tier: "team_standard" }, false)).toEqual({ status: 400, error: "이미 시트가 있습니다(Standard)." });
    expect(checkRequest(as, { status: "active", seat_tier: null }, false)).toBeNull();
  });
});

describe("canTransition", () => {
  it("허용 전이만 true", () => {
    expect(canTransition("requested", "running")).toBe(true);
    expect(canTransition("requested", "cancelled")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("running", "cancelled")).toBe(false);
    expect(canTransition("done", "running")).toBe(false);
    expect(canTransition("requested", "done")).toBe(false);
  });
});

describe("summarize", () => {
  it("대기·실행 중이 우선, 없으면 24시간 안의 마지막 1건, 조직별로 따로", () => {
    const old = { ...base, id: "old", status: "done" as const, requested_at: "2026-09-27T00:00:00.000Z" };
    const done = { ...base, id: "d1", status: "done" as const, requested_at: "2026-09-29T00:00:00.000Z", after_tier: "Unassigned" };
    const run = { ...base, id: "r1", status: "running" as const, requested_at: "2026-09-28T23:00:00.000Z" };
    const other = { ...base, id: "o2", org_id: "org-2", status: "failed" as const, error: "x", requested_at: "2026-09-29T01:30:00.000Z" };
    const m = summarize([old, done, run, other], now);
    expect(m.get("org-1|kim@innogrid.com")).toEqual({ id: "r1", action: "unassign", status: "running", target_tier: null, requested_at: "2026-09-28T23:00:00.000Z", error: null });
    expect(m.get("org-2|kim@innogrid.com")).toEqual({ id: "o2", action: "unassign", status: "failed", target_tier: null, requested_at: "2026-09-29T01:30:00.000Z", error: "x" });
    expect(summarize([old], now).size).toBe(0);
    expect(summarize([done], now).get("org-1|kim@innogrid.com")?.id).toBe("d1");
  });
});

describe("executorState", () => {
  it("기록 없음·60초 초과·로그인 필요·정상", () => {
    expect(executorState(null, now).level).toBe("off");
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:58:00.000Z", logged_in: true, note: null, host: null, version: null }, now)).toEqual({ level: "off", text: "실행기 꺼짐(마지막 2분 전) — 요청은 켜지면 처리됩니다" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:50.000Z", logged_in: false, note: "로그인 필요", host: null, version: null }, now)).toEqual({ level: "login", text: "claude.ai 로그인 필요 — 관리자 Mac에서 claude-seat-login.sh 실행" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:55.000Z", logged_in: true, note: null, host: "mac", version: "1" }, now)).toEqual({ level: "ok", text: "실행기 정상 · 방금" });
    expect(executorState({ id: "default", last_seen_at: "2026-09-29T01:59:20.000Z", logged_in: true, note: null, host: "mac", version: "1" }, now)).toEqual({ level: "ok", text: "실행기 정상 · 40초 전" });
  });
});

describe("overlaySeat", () => {
  it("claude_org_members 티어가 CSV 티어를 덮고, 요약은 조직·이메일로 붙는다", () => {
    const rows = [
      { org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Standard", chats: 0 },
      { org_id: "org-2", email: "kim@innogrid.com", seat_tier: "Standard", chats: 1 },
      { org_id: "org-1", email: "lee@innogrid.com", seat_tier: "Premium", chats: 2 },
    ];
    const members = [{ org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Unassigned" }, { org_id: "org-1", email: "lee@innogrid.com", seat_tier: null }];
    const out = overlaySeat(rows, members, summarize([base], now));
    expect(out[0]).toEqual({ org_id: "org-1", email: "kim@innogrid.com", seat_tier: "Unassigned", chats: 0, seat_action: { id: "a1", action: "unassign", status: "requested", target_tier: null, requested_at: "2026-09-29T01:00:00.000Z", error: null } });
    expect(out[1].seat_tier).toBe("Standard");
    expect(out[1].seat_action).toBeNull();
    expect(out[2].seat_tier).toBe("Premium");
  });
});
