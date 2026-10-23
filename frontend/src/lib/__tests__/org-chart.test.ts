import { describe, expect, it } from "vitest";
import { buildOrg } from "@/lib/directory/org";
import { ancestorIds, appActionUrl, defaultExpanded, deptPath, indexOrg, mailtoUrl, searchOrg } from "@/components/org/org-tree";

const data = buildOrg(
  [
    { id: "c", parent_id: null, name: "이노그리드", sort: 0, depth: 0 },
    { id: "a", parent_id: "c", name: "AI부문", sort: 1, depth: 1 },
    { id: "a1", parent_id: "a", name: "플랫폼본부", sort: 1, depth: 2 },
    { id: "a1x", parent_id: "a1", name: "개발팀", sort: 1, depth: 3 },
    { id: "a1x1", parent_id: "a1x", name: "파트", sort: 1, depth: 4 },
    { id: "b", parent_id: "c", name: "경영지원", sort: 2, depth: 1 },
  ],
  [
    { email: "kim@x.com", emp_seq: null, name: "김철수", dept_id: "a1x", dept_name: "개발팀", units: null, duty: null, position: null },
    { email: "lee@x.com", emp_seq: null, name: "이영희", dept_id: "a", dept_name: "AI부문", units: null, duty: null, position: null },
    { email: "park@x.com", emp_seq: null, name: "박민수", dept_id: "b", dept_name: "경영지원", units: null, duty: null, position: null },
  ],
);
const idx = indexOrg(data);

describe("org-tree", () => {
  it("직속·전체 인원", () => {
    expect(idx.root.id).toBe("c");
    expect(idx.total.get("c")).toBe(3);
    expect(idx.total.get("a")).toBe(2);
    expect(idx.direct.get("a")).toBe(1);
    expect(idx.total.get("a1x1")).toBe(0);
  });
  it("경로·조상", () => {
    expect(ancestorIds(idx, "a1x")).toEqual(["c", "a", "a1"]);
    expect(deptPath(idx, "a1x")).toBe("이노그리드 > AI부문 > 플랫폼본부 > 개발팀");
  });
  it("기본 펼침은 루트·1단계·2단계", () => {
    expect([...defaultExpanded(idx)].sort()).toEqual(["a", "a1", "b", "c"]);
  });
  it("사람 검색은 그 부서를 강조하고 조상을 펼친다", () => {
    const r = searchOrg(idx, data.people, "KIM@");
    expect(r.people.map((p) => p.name)).toEqual(["김철수"]);
    expect([...r.depts]).toEqual(["a1x"]);
    expect([...r.expand].sort()).toEqual(["a", "a1", "c"]);
  });
  it("부서 이름 검색은 그 부서 직속 직원을 표에 낸다", () => {
    const r = searchOrg(idx, data.people, "경영");
    expect(r.depts.has("b")).toBe(true);
    expect(r.people.map((p) => p.email)).toEqual(["park@x.com"]);
    expect(searchOrg(idx, data.people, "  ").people).toEqual([]);
  });
});

describe("메신저·메일 열기 주소", () => {
  const ppl = [
    { email: "a@x.com", empSeq: "11", name: "가" },
    { email: "b@x.com", empSeq: null, name: "나" },
  ];
  it("앱: 메신저는 사번 있는 사람만, 메일은 주소 전부", () => {
    const m = new URL(appActionUrl("messenger", ppl), "https://h");
    expect(m.pathname).toBe("/app-action");
    expect(Object.fromEntries(m.searchParams)).toEqual({ kind: "messenger", emp: "11", names: "가" });
    expect(new URL(appActionUrl("mail", ppl), "https://h").searchParams.get("to")).toBe("a@x.com,b@x.com");
  });
  it("브라우저: mailto", () => expect(mailtoUrl(ppl)).toBe("mailto:a@x.com,b@x.com"));
});
