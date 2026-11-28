import { describe, expect, it } from "vitest";
import { TIER_TO_API } from "@/lib/claude-usage/seat-tier";
// 실행기는 TS를 못 읽으므로 같은 규칙을 .mjs에 따로 갖는다 — 여기서 대조한다
import { AUTO_REQUESTER } from "@/lib/claude-usage/idle-seats";
import { AUTO_RELEASE_REQUESTER, TIER_TO_API as MJS_TIER_TO_API, activitySince, findMember, parseEnv } from "../../../scripts/lib/claude-seat.mjs";

describe("claude-seat.mjs", () => {
  it("자동 해제 요청자 표시가 TS와 같다", () => {
    expect(AUTO_RELEASE_REQUESTER).toBe(AUTO_REQUESTER.email);
  });
  it("해제 직전 확인: 분석 목록에 최근 활동이 있으면 근거를, 없거나 오래됐으면 null", () => {
    const page = { members: [{ email: "Kim@innogrid.com", last_active: "2026-11-27", chat_count: 3 }, { email: "old@innogrid.com", last_active: "2026-11-10", chat_count: 0 }] };
    expect(activitySince(page, "kim@innogrid.com", "2026-11-21")).toBe("마지막 활동 2026-11-27");
    expect(activitySince(page, "old@innogrid.com", "2026-11-21")).toBeNull();
    expect(activitySince(page, "none@innogrid.com", "2026-11-21")).toBeNull();
    expect(activitySince({ members: [{ email: "x@innogrid.com", last_active: null, code_session_count: 1 }] }, "x@innogrid.com", "2026-11-21")).toBe("마지막 활동 ?");
    expect(activitySince(null, "kim@innogrid.com", "2026-11-21")).toBeNull();
  });
  it("티어 매핑 표가 TS와 같다", () => {
    expect(MJS_TIER_TO_API).toEqual(TIER_TO_API);
  });
  it("멤버 응답이 배열·{members}·{data} 어느 모양이어도 이메일로 찾고, 없으면 null", () => {
    const m = { account: { uuid: "u-1", email_address: "Kim@Innogrid.com", full_name: "김" }, role: "user", seat_tier: "team_standard" };
    expect(findMember([m], "kim@innogrid.com")).toEqual({ uuid: "u-1", seat_tier: "team_standard", role: "user" });
    expect(findMember({ members: [m] }, " KIM@innogrid.com ")).toEqual({ uuid: "u-1", seat_tier: "team_standard", role: "user" });
    expect(findMember({ data: [m] }, "kim@innogrid.com")?.uuid).toBe("u-1");
    expect(findMember([{ role: "user" }], "kim@innogrid.com")).toBeNull();
    expect(findMember(null, "kim@innogrid.com")).toBeNull();
    expect(findMember("oops", "kim@innogrid.com")).toBeNull();
    expect(findMember([{ account: { uuid: "u-2", email_address: "lee@innogrid.com" }, seat_tier: null }], "lee@innogrid.com")).toEqual({ uuid: "u-2", seat_tier: "unassigned", role: "" });
  });
  it("env 파일에서 따옴표·주석을 벗기고 키를 읽는다", () => {
    expect(parseEnv('# c\nCLAUDE_OTEL_INGEST_TOKEN="abc"\nAPP_URL=https://x\n\nBAD\n')).toEqual({ CLAUDE_OTEL_INGEST_TOKEN: "abc", APP_URL: "https://x" });
  });
});
