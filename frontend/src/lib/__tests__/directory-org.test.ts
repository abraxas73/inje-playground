import { describe, expect, it } from "vitest";
import { buildOrg, descendants, type PersonRow } from "@/lib/directory/org";
import { normalizeDepartments } from "@/lib/directory/parse";
import { pagesForPath, canOpenPage } from "@/lib/page-access";

const p = (email: string, name: string, units: string[], dept_id: string | null = null): PersonRow => ({
  email, emp_seq: email.split("@")[0], name, dept_id, dept_name: units.at(-1) ?? null, units, duty: null, position: null,
});

describe("조직도 데이터", () => {
  it("부서 테이블이 있으면 그 트리 — 사람은 dept_id, 없으면 경로 이름으로 찾는다", () => {
    const deps = [
      { id: "1000", parent_id: null, name: "이노그리드", sort: 0, depth: 0 },
      { id: "10", parent_id: "1000", name: "기술·운영부문", sort: 1, depth: 1 },
      { id: "20", parent_id: "10", name: "R&D본부", sort: 2, depth: 2 },
      { id: "30", parent_id: "1000", name: "빈 부서", sort: 3, depth: 1 },
    ];
    const o = buildOrg(deps, [p("a@x.com", "가", ["기술·운영부문", "R&D본부"], "20"), p("b@x.com", "나", ["기술·운영부문", "R&D본부"], "999")], "2026-10-23T00:00:00Z");
    expect(o.derived).toBe(false);
    expect(o.departments.map((d) => d.id)).toEqual(["1000", "10", "30", "20"]);
    expect(o.people.map((x) => x.deptId)).toEqual(["20", "20"]);
    expect([...descendants(o.departments, "10")].sort()).toEqual(["10", "20"]);
  });

  it("부서 테이블이 비면 사람들의 부서 경로로 트리를 만든다(회사 루트 아래)", () => {
    const o = buildOrg([], [p("a@x.com", "가", ["경영지원부문", "경영지원팀"]), p("b@x.com", "나", ["경영지원부문"]), p("c@x.com", "다", [])]);
    expect(o.derived).toBe(true);
    const root = o.departments.find((d) => d.parentId === null)!;
    expect(root.name).toBe("이노그리드");
    expect(o.departments.find((d) => d.name === "경영지원팀")!.parentId).toBe("경영지원부문");
    expect(Object.fromEntries(o.people.map((x) => [x.name, x.deptId]))).toEqual({ 가: "경영지원부문>경영지원팀", 나: "경영지원부문", 다: root.id });
  });

  it("부서 원본 정리 — id·이름 없으면 버리고 중복 id는 첫 항목, 숫자는 정수로", () => {
    expect(normalizeDepartments([{ id: "1", name: "A", sort: "3", depth: 1 }, { id: "1", name: "B" }, { id: "", name: "C" }, { id: "2" }, null])).toEqual([
      { id: "1", parent_id: null, name: "A", path: null, sort: 3, depth: 1 },
    ]);
  });

  it("조직도 페이지·API는 org_chart 권한(user 이상)", () => {
    expect(pagesForPath("/org")).toEqual(["org_chart"]);
    expect(pagesForPath("/api/directory/org")).toEqual(["org_chart"]);
    expect(canOpenPage("user", "/org")).toBe(true);
    expect(canOpenPage("guest", "/org")).toBe(false);
    expect(canOpenPage("user", "/org", { org_chart: false })).toBe(false);
  });
});
