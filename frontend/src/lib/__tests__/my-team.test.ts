import { describe, it, expect } from "vitest";
import { memberKey, splitCurrent, isValidEmail, isPersonalEmail, mergeManual, toDrafts, userMembersToMembers } from "@/lib/my-team";

describe("memberKey", () => {
  it("이메일이 있으면 소문자 이메일, 없으면 name: 접두 키", () => {
    expect(memberKey({ name: "홍길동", email: "Hong@Innogrid.com" })).toBe("hong@innogrid.com");
    expect(memberKey({ name: "홍길동", email: "  " })).toBe("name:홍길동");
    expect(memberKey({ name: " 홍길동 ", email: null })).toBe("name:홍길동");
  });
});

describe("splitCurrent", () => {
  const source = [
    { id: "u1", name: "강승억", email: "su@gmail.com" },
    { id: "u2", name: "이영희", email: "yh@innogrid.com" },
    { id: "u3", name: "김철수", email: "cs@innogrid.com" },
    { id: "u4", name: "김철수", email: "cs2@innogrid.com" },
  ];

  it("external_id 우선 매칭 + 덮어쓴 이메일은 overrides로 복원", () => {
    const r = splitCurrent([{ name: "강승억", email: "su@innogrid.com", external_id: "u1" }], source);
    expect([...r.preselectedIds]).toEqual(["u1"]);
    expect(r.overrides).toEqual({ u1: "su@innogrid.com" });
    expect(r.extras).toEqual([]);
  });

  it("external_id 없으면 이메일, 그다음 이름(유일할 때만)으로 매칭; 동명이인은 매칭하지 않고 extras", () => {
    const r = splitCurrent(
      [
        { name: "이영희", email: "YH@innogrid.com", external_id: null },
        { name: "강승억", email: null, external_id: null },
        { name: "김철수", email: null, external_id: null },
        { name: "외부인", email: "ext@partner.com", external_id: null },
      ],
      source
    );
    expect([...r.preselectedIds].sort()).toEqual(["u1", "u2"]);
    expect(r.overrides).toEqual({});
    expect(r.extras).toEqual([{ name: "김철수" }, { name: "외부인", email: "ext@partner.com" }]);
  });
});

describe("isPersonalEmail", () => {
  it("개인 메일 도메인 감지(Teams DM 불가 경고용)", () => {
    expect(isPersonalEmail("a@gmail.com")).toBe(true);
    expect(isPersonalEmail("a@Naver.com")).toBe(true);
    expect(isPersonalEmail("a@innogrid.com")).toBe(false);
    expect(isPersonalEmail(undefined)).toBe(false);
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
    expect(toDrafts([{ id: "u1", name: "강승억", email: "su@gmail.com" }], { u1: "su@innogrid.com" })).toEqual([
      { name: "강승억", email: "su@innogrid.com", external_id: "u1" },
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
