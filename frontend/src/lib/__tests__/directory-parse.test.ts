import { describe, it, expect } from "vitest";
import { splitDeptPath, normalizePerson, normalizeRoster } from "@/lib/directory/parse";

describe("splitDeptPath", () => {
  it("회사 세그먼트(연속 동일 이름)를 떼고 단위만 남긴다 — 깊이 6", () => {
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드>기술·운영부문>R&D본부>클라우드 네이티브 센터>XPU플랫폼팀"))
      .toEqual(["기술·운영부문", "R&D본부", "클라우드 네이티브 센터", "XPU플랫폼팀"]);
  });
  it("깊이 5/4/3도 처리한다", () => {
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드>기술·운영부문>R&D본부>클라우드 네이티브 센터")).toEqual(["기술·운영부문", "R&D본부", "클라우드 네이티브 센터"]);
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드>기술·운영부문>CCoE본부")).toEqual(["기술·운영부문", "CCoE본부"]);
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드>경영지원부문")).toEqual(["경영지원부문"]);
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드>대표이사>성장전략팀")).toEqual(["대표이사", "성장전략팀"]);
  });
  it("빈 값·회사명만 있는 경로·공백 세그먼트", () => {
    expect(splitDeptPath(null)).toEqual([]);
    expect(splitDeptPath("(주)이노그리드>(주)이노그리드")).toEqual([]);
    expect(splitDeptPath(" (주)이노그리드 > 경영지원부문 > ")).toEqual(["경영지원부문"]);
  });
});

describe("normalizePerson / normalizeRoster", () => {
  const raw = {
    deptId: "2989", deptName: "클라우드 네이티브 센터",
    deptPath: "(주)이노그리드>(주)이노그리드>기술·운영부문>R&D본부>클라우드 네이티브 센터",
    duty: "센터장", dutyCode: "300", email: "Seunguk.Kang@innogrid.com", empSeq: "3060", loginId: "seunguk.kang",
    mobile: "010-0000-0000", name: "강승억", note: "", position: "상무",
  };
  it("이메일 소문자, 단위 분해(division/headquarters/team), 휴대폰은 제외", () => {
    const r = normalizePerson(raw)!;
    expect(r).toMatchObject({
      email: "seunguk.kang@innogrid.com", emp_seq: "3060", login_id: "seunguk.kang", name: "강승억",
      dept_id: "2989", dept_name: "클라우드 네이티브 센터",
      units: ["기술·운영부문", "R&D본부", "클라우드 네이티브 센터"],
      division: "기술·운영부문", headquarters: "R&D본부", team: "클라우드 네이티브 센터",
      duty: "센터장", position: "상무",
    });
    expect("mobile" in r).toBe(false);
  });
  it("이메일 없으면 null, deptName 없으면 경로 말단이 team, 이름 없으면 이메일 로컬파트", () => {
    expect(normalizePerson({ name: "익명", deptPath: "(주)이노그리드>경영지원부문" })).toBeNull();
    const r = normalizePerson({ email: "x@innogrid.com", deptPath: "(주)이노그리드>(주)이노그리드>사업·전략부문>영업본부" })!;
    expect(r).toMatchObject({ name: "x", team: "영업본부", division: "사업·전략부문", headquarters: "영업본부", dept_name: null });
    const only = normalizePerson({ email: "y@innogrid.com", name: "y", deptPath: "(주)이노그리드>(주)이노그리드>경영지원부문", deptName: "경영지원부문" })!;
    expect(only).toMatchObject({ division: "경영지원부문", headquarters: null, team: "경영지원부문" });
  });
  it("명부: 이메일 중복은 첫 항목만, 이메일 없는 항목은 skipped", () => {
    const { rows, skipped } = normalizeRoster([raw, { ...raw, email: "SEUNGUK.KANG@innogrid.com", name: "중복" }, { name: "없음" }, null]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("강승억");
    expect(skipped).toBe(2);
    expect(normalizeRoster("nope")).toEqual({ rows: [], skipped: 0 });
  });
});
