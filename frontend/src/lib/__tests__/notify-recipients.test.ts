import { describe, it, expect } from "vitest";
import { parseRecipients } from "@/lib/notify/recipients";

describe("parseRecipients", () => {
  it("recipients 배열을 우선 사용하고 문자열 필드만 남긴다", () => {
    expect(
      parseRecipients({
        recipients: [{ email: "a@b.c", name: "A", memberId: 1 }, { memberId: "m2" }, null, "junk"],
        member_ids: ["ignored"],
      })
    ).toEqual([{ email: "a@b.c", name: "A", memberId: undefined }, { email: undefined, name: undefined, memberId: "m2" }]);
  });

  it("recipients가 없으면 member_ids를 {memberId}로 변환(하위 호환)", () => {
    expect(parseRecipients({ member_ids: ["m1", 2, "m3"] })).toEqual([{ memberId: "m1" }, { memberId: "m3" }]);
  });

  it("둘 다 없거나 빈 배열이면 []", () => {
    expect(parseRecipients({})).toEqual([]);
    expect(parseRecipients({ recipients: [] , member_ids: [] })).toEqual([]);
    expect(parseRecipients(null)).toEqual([]);
  });
});
