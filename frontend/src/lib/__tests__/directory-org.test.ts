import { describe, expect, it } from "vitest";
import { buildOrg, descendants, photoUrls, type PersonRow } from "@/lib/directory/org";
import { normalizeDepartments, normalizePerson } from "@/lib/directory/parse";
import { sniffImage } from "@/lib/directory/photos";
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

  it("사진 — 경로를 우리 API 주소(썸네일·원본)로, 모양이 틀리면 없음. 경로를 안 보낸 동기화는 칸을 건드리지 않는다", () => {
    expect(photoUrls("gcmsAmaranth31433/empPic/7cdcb9b5-8ac3_jpg")).toEqual({ photo: "/api/directory/photo/7cdcb9b5-8ac3_jpg", photoLarge: "/api/directory/photo/7cdcb9b5-8ac3_jpg?size=large" });
    expect(photoUrls("../x/empPic/a")).toEqual({ photo: null, photoLarge: null });
    expect(photoUrls("g/empPic/..")).toEqual({ photo: null, photoLarge: null });
    expect(photoUrls(null)).toEqual({ photo: null, photoLarge: null });
    const person = buildOrg([], [{ ...p("a@x.com", "가", ["개발"]), photo_path: "g/empPic/id_jpg" }]).people[0];
    expect([person.photo, person.photoPath]).toEqual(["/api/directory/photo/id_jpg", "g/empPic/id_jpg"]);
    expect(buildOrg([], [p("b@x.com", "나", ["개발"])]).people[0].photoPath).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    const base = { email: "a@x.com", name: "가" };
    expect(normalizePerson({ ...base, photoPath: "g/empPic/id_jpg" })!.photo_path).toBe("g/empPic/id_jpg");
    expect(normalizePerson({ ...base, photoPath: "" })!.photo_path).toBeNull();
    expect(normalizePerson({ ...base, photoPath: "https://evil/x" })!.photo_path).toBeNull();
    expect("photo_path" in normalizePerson(base)!).toBe(false);
  });
});
