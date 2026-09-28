import { describe, expect, it } from "vitest";
import { contributorsSuppressed, hourlyTargets, offHoursShare, parseKinds } from "@/lib/work-metrics/hourly";

describe("parseKinds", () => {
  it("허용 종류만, 비면 커밋 기본", () => {
    expect(parseKinds("commit,issue,x")).toEqual(["commit", "issue"]);
    expect(parseKinds(null)).toEqual(["commit"]);
    expect(parseKinds("mr,mr")).toEqual(["mr"]);
  });
});

describe("hourlyTargets", () => {
  const m = (n: number) => Array.from({ length: n }, (_, i) => ({ email: `u${i}@innogrid.com` }));
  it("본인 화면은 1명이어도 보이고, 조직 화면은 3명 미만이면 숨긴다", () => {
    expect(hourlyTargets(m(1), { self: true })).toEqual({ emails: ["u0@innogrid.com"], suppressed: false });
    expect(hourlyTargets(m(2), { self: false })).toEqual({ emails: null, suppressed: true });
    expect(hourlyTargets(m(3), { self: false }).suppressed).toBe(false);
  });
});

describe("contributorsSuppressed", () => {
  it("구성원 수가 아니라 실제 활동한 사람이 3명 미만이면 숨긴다(본인 화면은 예외)", () => {
    expect(contributorsSuppressed(0, false)).toBe(true);
    expect(contributorsSuppressed(2, false)).toBe(true);
    expect(contributorsSuppressed(3, false)).toBe(false);
    expect(contributorsSuppressed(1, true)).toBe(false);
  });
});

describe("offHoursShare", () => {
  it("업무시간 = 평일 09~17시. 그 밖과 주말을 센다", () => {
    const r = offHoursShare([
      { kind: "commit", dow: 1, hour: 9, n: 4 },   // 월 09시 — 업무시간
      { kind: "commit", dow: 1, hour: 17, n: 1 },  // 월 17시 — 업무시간
      { kind: "commit", dow: 1, hour: 18, n: 2 },  // 월 18시 — 밖
      { kind: "commit", dow: 6, hour: 10, n: 3 },  // 토 — 주말(밖)
    ]);
    expect(r).toEqual({ total: 10, offHours: 5, weekend: 3, offShare: 0.5, weekendShare: 0.3 });
    expect(offHoursShare([])).toEqual({ total: 0, offHours: 0, weekend: 0, offShare: null, weekendShare: null });
  });
});
