import { describe, it, expect } from "vitest";
import { RULES, buildFeatureIndex, requirementText, scoreFeature, isCandidate, rationaleFor, matchRequirement, matchChunk } from "@/lib/rfp/mapping/rules";
import type { CatalogSolution, CatalogFeature } from "@/lib/rfp/mapping/types";
import type { ChunkRequirement } from "@/lib/rfp/mapping/chunk";

const feat = (id: string, solutionCode: string, name: string, description: string, keywords: string[], isActive = true): CatalogFeature =>
  ({ id, solutionCode, name, description, evidenceUrl: null, isActive, keywords });
const catalog: CatalogSolution[] = [
  { code: "secloudit", name: "SECloudit", description: "", isActive: true, sortOrder: 1, features: [
    feat("f-sso", "secloudit", "SSO 로그인", "통합 인증으로 한 번 로그인", ["sso", "로그인", "통합", "인증"]),
    feat("f-acl", "secloudit", "접근 제어", "사용자 접근 통제", ["접근"]),
    feat("f-short", "secloudit", "접근 제어2", "", []),
    feat("f-off", "secloudit", "비활성", "sso 로그인 통합 인증", ["sso"], false),
  ] },
  { code: "openstackit", name: "Openstackit", description: "", isActive: true, sortOrder: 2, features: [
    feat("f-vm", "openstackit", "가상 머신 생성", "VM 인스턴스 생성 및 관리", ["가상", "머신", "생성", "vm", "인스턴스"]),
  ] },
  { code: "off", name: "꺼진 솔루션", description: "", isActive: false, sortOrder: 3, features: [feat("f-x", "off", "SSO", "", ["sso"])] },
];
const req = (reqId: string, title: string, definition = "", details = ""): ChunkRequirement => ({ id: `${reqId}-uuid`, reqId, title, categoryName: "c", definition, details });
const index = buildFeatureIndex(catalog);

describe("buildFeatureIndex", () => {
  it("활성 솔루션의 활성 기능만, 이름 토큰·bigram을 미리 만든다", () => {
    expect(index.map((f) => f.featureId)).toEqual(["f-sso", "f-acl", "f-short", "f-vm"]);
    expect([...index[0].nameTokens]).toEqual(["sso", "로그인"]);
    expect(index[0].bigrams.size).toBeGreaterThanOrEqual(RULES.MIN_FEATURE_BIGRAMS);
    expect(index[2].bigrams.size).toBeLessThan(RULES.MIN_FEATURE_BIGRAMS);
  });
});

describe("scoreFeature", () => {
  const r = requirementText(req("SER-001", "통합 인증(SSO) 기능", "사용자는 한 번 로그인으로 모든 시스템에 접근"));
  it("이름 토큰 키워드는 2, 설명 키워드는 1로 더하고 overlap 유사도를 합쳐 1에서 자른다", () => {
    const d = scoreFeature(r, index[0]);
    expect(d.hits).toEqual(["sso", "로그인", "인증", "통합"]);
    expect(d.hitWeight).toBe(6);
    expect(d.sim).toBeGreaterThan(0.5);
    expect(d.score).toBe(1);
    expect(isCandidate(d)).toBe(true);
  });
  it("bigram이 6개 미만인 기능은 유사도 0 — 키워드가 없으면 후보가 아니다", () => {
    const d = scoreFeature(r, index[2]);
    expect(d.sim).toBe(0);
    expect(d.hitWeight).toBe(0);
    expect(isCandidate(d)).toBe(false);
  });
  it("키워드가 하나라도 맞으면 후보. 점수 = 0.15×가중치 + 0.7×유사도(소수 2자리)", () => {
    const d = scoreFeature(r, index[1]);
    expect(d.hits).toEqual(["접근"]);
    expect(d.hitWeight).toBe(2);
    expect(isCandidate(d)).toBe(true);
    expect(d.score).toBe(Math.round(Math.min(1, 0.15 * 2 + 0.7 * d.sim) * 100) / 100);
  });
  it("맞는 키워드가 없고 유사도도 낮으면 후보가 아니다", () => {
    const d = scoreFeature(r, index[3]);
    expect(d.hitWeight).toBe(0);
    expect(d.sim).toBeLessThan(RULES.SIM_THRESHOLD);
    expect(isCandidate(d)).toBe(false);
  });
  it("3자 이상 키워드는 부분 문자열로도 맞고, 2자 키워드는 토큰 일치만", () => {
    const idx = buildFeatureIndex([{ code: "s", name: "S", description: "", isActive: true, sortOrder: 1, features: [
      feat("a", "s", "테넌트", "", ["멀티테넌트"]), feat("b", "s", "VM", "", ["vm"]),
    ] }]);
    const t = requirementText(req("R", "멀티테넌트환경에서 KVM기반 운영"));
    expect(scoreFeature(t, idx[0]).hits).toEqual(["멀티테넌트"]);
    expect(scoreFeature(t, idx[1]).hits).toEqual([]);
  });
});

describe("rationaleFor", () => {
  it("키워드가 있으면 목록(최대 5개)+유사도, 없으면 유사도만", () => {
    expect(rationaleFor({ hits: ["sso", "로그인"], hitWeight: 4, sim: 0.4237, score: 1 })).toBe("자동 매칭 — 일치 키워드: sso, 로그인 · 유사도 0.42");
    expect(rationaleFor({ hits: ["a", "b", "c", "d", "e", "f"], hitWeight: 6, sim: 0, score: 0.9 })).toBe("자동 매칭 — 일치 키워드: a, b, c, d, e · 유사도 0.00");
    expect(rationaleFor({ hits: [], hitWeight: 0, sim: 0.35, score: 0.25 })).toBe("자동 매칭 — 유사도 0.35");
  });
});

describe("matchRequirement / matchChunk", () => {
  it("후보를 점수순으로 최대 3개, 솔루션당 2개까지 candidate 행으로 낸다", () => {
    const many: CatalogSolution[] = [
      { code: "s1", name: "S1", description: "", isActive: true, sortOrder: 1, features: ["a1", "a2", "a3", "a4"].map((n) => feat(n, "s1", n, "", ["로그인"])) },
      { code: "s2", name: "S2", description: "", isActive: true, sortOrder: 2, features: [feat("b1", "s2", "b1", "", ["로그인"])] },
    ];
    const items = matchRequirement(req("SER-001", "로그인 기능"), buildFeatureIndex(many));
    expect(items.map((i) => i.feature)).toEqual(["a1", "a2", "b1"]);
    expect(items[0]).toEqual({ reqId: "SER-001", verdict: "candidate", feature: "a1", rationale: "자동 매칭 — 일치 키워드: 로그인 · 유사도 0.00", score: 0.15 });
  });
  it("후보가 없는 요구사항은 행을 내지 않고, 청크는 요구사항 순서대로 이어 붙인다", () => {
    const items = matchChunk([req("SER-001", "통합 인증(SSO) 기능", "한 번 로그인으로 접근"), req("SER-002", "사업 관리 산출물 제출"), req("SER-003", "가상 머신 생성")], index);
    expect(items.filter((i) => i.reqId === "SER-002")).toEqual([]);
    expect(items.filter((i) => i.reqId === "SER-001").map((i) => i.feature)).toEqual(["f-sso", "f-acl"]);
    expect(items.filter((i) => i.reqId === "SER-003")[0].feature).toBe("f-vm");
    expect(items.every((i) => i.verdict === "candidate" && typeof i.score === "number")).toBe(true);
  });
});
