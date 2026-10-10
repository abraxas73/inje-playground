import { expect, it } from "vitest";
import { ownerLabel } from "@/lib/ppt/owner-label";

it("소유자 표시 — 명부 이름(팀) > 프로필 이름 > 이메일 앞부분", () => {
  expect(ownerLabel({ email: "a@innogrid.com", name: "강승억", team: "네이티브플랫폼팀" })).toBe("강승억(네이티브플랫폼팀)");
  expect(ownerLabel({ email: "a@innogrid.com", name: "강승억", team: "" })).toBe("강승억");
  expect(ownerLabel({ email: "a@innogrid.com", displayName: " 홍길동 " })).toBe("홍길동");
  expect(ownerLabel({ email: "someone@innogrid.com" })).toBe("someone");
});
