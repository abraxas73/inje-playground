import { describe, it, expect } from "vitest";
import { isShareToken, isShareVisibility, mapShareLink, newShareToken, shareUrl, toSharedProject, type ShareLinkDbRow } from "@/lib/rfp/share";
import type { CatalogSolution } from "@/lib/rfp/mapping/types";
import type { RfpMapping, RfpRequirement } from "@/types/rfp";

const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    { id: "f-iam", solutionCode: "secloudit", name: "IAM", description: "", evidenceUrl: "https://wiki.local/iam", isActive: true, keywords: [] },
  ] },
];

const mapping = (o: Partial<RfpMapping> = {}): RfpMapping => ({
  id: "m1", requirementId: "q1", solutionCode: "secloudit", featureId: "f-iam", verdict: "fulfilled",
  rationale: "이유", evidenceUrl: "https://wiki.innogrid.com/page/1", edited: false, sortOrder: 0,
  detailKey: "1", detailText: "첫째", evidenceText: "근거 문장", note: "내부 메모",
  engine: "rules", score: 1, updatedAt: "2026-09-09T00:00:00Z", updatedBy: null, ...o,
});

const requirement: RfpRequirement = {
  id: "q1", categoryCode: "SER", categoryName: "서비스 요구사항", reqId: "SER-001", title: "제목",
  definition: "정의", details: "○ 첫째\n○ 둘째", deliverables: "", related: "", solution: "", sortOrder: 0,
  source: { blockIndex: 0 }, updatedAt: "2026-09-09T00:00:00Z", updatedBy: null,
} as RfpRequirement;

const project = {
  id: "p1", name: "사업", agency: "기관", period: null, budget: null, bidMethod: null,
  extra: {}, requirementCount: 1, mappingAt: null, updatedAt: "2026-09-09T00:00:00Z",
};

describe("공유 링크 토큰", () => {
  it("URL-safe 32자 이상, 매번 다르다", () => {
    const a = newShareToken(), b = newShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(32);
    expect(a).not.toBe(b);
    expect(isShareToken(a)).toBe(true);
  });
  it("형식이 아닌 값은 거른다(DB를 두드리기 전에)", () => {
    for (const v of ["", "짧음", "a".repeat(65), "abc/../x", "abc def", null, 123]) expect(isShareToken(v)).toBe(false);
  });
  it("visibility는 public/private만", () => {
    expect(isShareVisibility("public")).toBe(true);
    expect(isShareVisibility("private")).toBe(true);
    expect(isShareVisibility("secret")).toBe(false);
    expect(isShareVisibility(undefined)).toBe(false);
  });
  it("링크 URL은 /rfp/shared/{token}, 오리진 끝 슬래시는 정리한다", () => {
    expect(shareUrl("https://x.app/", "TOKEN")).toBe("https://x.app/rfp/shared/TOKEN");
  });
});

describe("mapShareLink", () => {
  it("응답에 토큰을 따로 내려주지 않는다(URL 안에만)", () => {
    const row: ShareLinkDbRow = {
      id: "s1", project_id: "p1", token: "TOK", visibility: "public", created_by: "u1",
      created_at: "2026-09-09T00:00:00Z", view_count: 3, last_viewed_at: "2026-09-09T01:00:00Z",
    };
    const link = mapShareLink(row, "https://x.app");
    expect(link).toEqual({
      id: "s1", visibility: "public", url: "https://x.app/rfp/shared/TOK",
      createdAt: "2026-09-09T00:00:00Z", viewCount: 3, lastViewedAt: "2026-09-09T01:00:00Z",
    });
    expect(Object.keys(link)).not.toContain("token");
  });
});

describe("toSharedProject", () => {
  it("공개 링크는 근거 URL·비고를 감추고 솔루션·기능 이름을 붙인다", () => {
    const out = toSharedProject(project, [requirement], [mapping()], catalog, "public");
    expect(out.visibility).toBe("public");
    expect(out.mappings[0].evidenceUrl).toBeNull();
    expect(out.mappings[0].note).toBeNull();
    expect(out.mappings[0].evidenceText).toBe("근거 문장");
    expect(out.mappings[0].solutionName).toBe("SECloudit");
    expect(out.mappings[0].featureName).toBe("IAM");
  });

  it("사내 링크는 근거 URL·비고를 그대로 담는다", () => {
    const out = toSharedProject(project, [requirement], [mapping()], catalog, "private");
    expect(out.mappings[0].evidenceUrl).toBe("https://wiki.innogrid.com/page/1");
    expect(out.mappings[0].note).toBe("내부 메모");
  });

  it("payload에 파일·SharePoint·소유자 정보가 없다", () => {
    const out = toSharedProject(project, [requirement], [mapping()], catalog, "private");
    const keys = Object.keys(out);
    expect(keys.sort()).toEqual(["mappings", "project", "requirements", "visibility"]);
    expect(Object.keys(out.project)).not.toContain("createdBy");
    expect(JSON.stringify(out)).not.toContain("sharepoint");
  });

  it("카탈로그에 없는 기능은 이름 null(삭제된 기능도 화면이 깨지지 않게)", () => {
    const out = toSharedProject(project, [requirement], [mapping({ featureId: "gone" })], catalog, "private");
    expect(out.mappings[0].featureName).toBeNull();
    expect(out.mappings[0].solutionName).toBe("SECloudit");
  });
});
