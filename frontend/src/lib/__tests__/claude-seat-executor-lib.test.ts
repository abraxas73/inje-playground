import { describe, expect, it } from "vitest";
import { TIER_TO_API } from "@/lib/claude-usage/seat-tier";
// 실행기는 TS를 못 읽으므로 같은 규칙을 .mjs에 따로 갖는다 — 여기서 대조한다
import { TIER_TO_API as MJS_TIER_TO_API, findMember, parseEnv } from "../../../scripts/lib/claude-seat.mjs";

describe("claude-seat.mjs", () => {
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
  });
  it("env 파일에서 따옴표·주석을 벗기고 키를 읽는다", () => {
    expect(parseEnv('# c\nCLAUDE_OTEL_INGEST_TOKEN="abc"\nAPP_URL=https://x\n\nBAD\n')).toEqual({ CLAUDE_OTEL_INGEST_TOKEN: "abc", APP_URL: "https://x" });
  });
});
