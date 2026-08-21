import { describe, it, expect } from "vitest";
import { memberKey, preselectKeys, splitCurrent, isValidEmail, mergeManual, toDrafts, userMembersToMembers } from "@/lib/my-team";

describe("memberKey", () => {
  it("이메일이 있으면 소문자 이메일, 없으면 name: 접두 키", () => {
    expect(memberKey({ name: "홍길동", email: "Hong@Innogrid.com" })).toBe("hong@innogrid.com");
    expect(memberKey({ name: "홍길동", email: "  " })).toBe("name:홍길동");
    expect(memberKey({ name: " 홍길동 ", email: null })).toBe("name:홍길동");
  });
});

describe("preselectKeys", () => {
  it("현재 내 팀(이메일 우선, 없으면 이름)과 일치하는 소스 항목의 키를 돌려준다", () => {
    const current = [
      { name: "강승억", email: "su@innogrid.com" },
      { name: "이영희", email: null },
      { name: "없는사람", email: "none@innogrid.com" },
    ];
    const source = [
      { id: "u1", name: "강승억(팀장)", email: "SU@innogrid.com" },
      { id: "u2", name: "이영희", email: "yh@innogrid.com" },
      { id: "u3", name: "김철수", email: "cs@innogrid.com" },
    ];
    expect([...preselectKeys(current, source)].sort()).toEqual(["su@innogrid.com", "yh@innogrid.com"]);
  });
});

describe("splitCurrent", () => {
  it("소스에 있는 사람은 preselected, 없는 사람은 extras(직접 추가)로 유지", () => {
    const current = [
      { name: "강승억", email: "su@innogrid.com", external_id: "u1" },
      { name: "이영희", email: null, external_id: null },
      { name: "외부인", email: "ext@partner.com", external_id: null },
      { name: "수동", email: null, external_id: null },
    ];
    const source = [
      { id: "u1", name: "강승억", email: "su@innogrid.com" },
      { id: "u2", name: "이영희", email: "yh@innogrid.com" },
    ];
    const r = splitCurrent(current, source);
    expect([...r.preselected].sort()).toEqual(["su@innogrid.com", "yh@innogrid.com"]);
    expect(r.extras).toEqual([{ name: "외부인", email: "ext@partner.com", external_id: undefined }, { name: "수동" }]);
  });
});

describe("isValidEmail", () => {
  it("기본 형식 검사", () => {
    expect(isValidEmail("a@innogrid.com")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("")).toBe(false);
  });
});

describe("mergeManual", () => {
  it("이름/이메일을 trim 하고 같은 키는 덮어쓰며 순서는 유지", () => {
    const list = [{ name: "A", email: "a@x.com" }, { name: "B" }];
    expect(mergeManual(list, { name: " C ", email: " C@X.com " })).toEqual([
      { name: "A", email: "a@x.com" },
      { name: "B" },
      { name: "C", email: "c@x.com" },
    ]);
    expect(mergeManual(list, { name: "A-개명", email: "A@x.com" })).toEqual([
      { name: "A-개명", email: "a@x.com" },
      { name: "B" },
    ]);
    expect(mergeManual(list, { name: "B", email: "" })).toEqual(list);
  });

  it("이름이 비면 추가하지 않는다", () => {
    expect(mergeManual([], { name: "  ", email: "x@y.com" })).toEqual([]);
  });
});

describe("toDrafts / userMembersToMembers", () => {
  it("소스 Member → 저장용 draft(external_id=id), user_members → 점심 모달용 Member", () => {
    expect(toDrafts([{ id: "u1", name: "강승억", email: "su@innogrid.com" }, { id: "u2", name: "B" }])).toEqual([
      { name: "강승억", email: "su@innogrid.com", external_id: "u1" },
      { name: "B", email: undefined, external_id: "u2" },
    ]);
    expect(
      userMembersToMembers([
        { id: "row-1", name: "강승억", email: "su@innogrid.com", external_id: "u1" },
        { id: "row-2", name: "수동", email: null, external_id: null },
      ])
    ).toEqual([
      { id: "u1", name: "강승억", email: "su@innogrid.com" },
      { id: "row-2", name: "수동", email: undefined },
    ]);
  });
});
