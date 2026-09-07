import { describe, it, expect } from "vitest";
import { RULES, buildFeatureIndex, requirementText, scoreFeature, isCandidate, rationaleFor, matchRequirement, matchChunk, evidenceSentence } from "@/lib/rfp/mapping/rules";
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
  it("이름 토큰 키워드는 2, 설명 키워드는 1로 더하고 cosine 유사도를 합쳐 1에서 자른다", () => {
    const d = scoreFeature(r, index[0]);
    expect(d.hits).toEqual(["sso", "로그인", "인증", "통합"]);
    expect(d.hitWeight).toBe(6);
    expect(d.sim).toBeGreaterThan(0.4);
    expect(d.score).toBe(1);
    expect(isCandidate(d)).toBe(true);
  });
  it("bigram이 6개 미만인 기능은 유사도 0 — 키워드가 없으면 후보가 아니다", () => {
    const d = scoreFeature(r, index[2]);
    expect(d.sim).toBe(0);
    expect(d.hitWeight).toBe(0);
    expect(isCandidate(d)).toBe(false);
  });
  it("이름 키워드 하나(가중치 2)면 후보. 점수 = 0.15×가중치 + 0.7×유사도(소수 2자리)", () => {
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

describe("isCandidate — 경계", () => {
  it("히트 0이면 유사도 0.50부터, 키워드 가중치 2(이름 1개 또는 설명 2개)부터 후보", () => {
    const base = { hits: [] as string[], hitWeight: 0, score: 0 };
    expect(isCandidate({ ...base, sim: 0.49 })).toBe(false);
    expect(isCandidate({ ...base, sim: RULES.SIM_THRESHOLD })).toBe(true);
    expect(isCandidate({ hits: ["x"], hitWeight: 1, sim: 0, score: 0.15 })).toBe(false);
    expect(isCandidate({ hits: ["x", "y"], hitWeight: 2, sim: 0, score: 0.3 })).toBe(true);
    expect(isCandidate({ hits: [], hitWeight: 0, sim: 0, score: 0 })).toBe(false);
  });
});

describe("buildFeatureIndex — 흔한 키워드 제거", () => {
  it("활성 기능 20개 이상이면 5%를 넘게 쓰인 키워드는 매칭 목록에서 빠진다", () => {
    const features = Array.from({ length: 30 }, (_, i) => feat(`f${i}`, "s", `기능${i}`, "", ["공통어", `고유${i}`]));
    const idx = buildFeatureIndex([{ code: "s", name: "S", description: "", isActive: true, sortOrder: 1, features }]);
    expect(idx.every((f) => !f.keywords.includes("공통어"))).toBe(true);
    expect(idx[3].keywords).toEqual(["고유3"]);
    const small = buildFeatureIndex([{ code: "s", name: "S", description: "", isActive: true, sortOrder: 1, features: features.slice(0, 5) }]);
    expect(small[0].keywords).toContain("공통어");
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
  /** 솔루션 s1~s4에 각각 "로그인" 기능 2개 — 솔루션당 2개 상한과 전체 상한을 함께 시험한다 */
  const manySolutions = (n: number): CatalogSolution[] =>
    Array.from({ length: n }, (_, i) => ({
      code: `s${i + 1}`, name: `S${i + 1}`, description: "", isActive: true, sortOrder: i + 1,
      features: ["a", "b"].map((x) => feat(`s${i + 1}${x}`, `s${i + 1}`, `s${i + 1}${x} 로그인`, "", ["로그인"])),
    }));

  it("후보를 점수순으로 솔루션당 2개까지 candidate 행으로 낸다", () => {
    const many: CatalogSolution[] = [
      { code: "s1", name: "S1", description: "", isActive: true, sortOrder: 1, features: ["a1", "a2", "a3", "a4"].map((n) => feat(n, "s1", `${n} 로그인`, "", ["로그인"])) },
      { code: "s2", name: "S2", description: "", isActive: true, sortOrder: 2, features: [feat("b1", "s2", "b1 로그인", "", ["로그인"])] },
    ];
    const items = matchRequirement(req("SER-001", "로그인 기능"), buildFeatureIndex(many));
    expect(items.map((i) => i.feature)).toEqual(["a1", "a2", "b1"]);
    expect(items[0]).toEqual({ reqId: "SER-001", verdict: "candidate", feature: "a1", rationale: "자동 매칭 — 일치 키워드: 로그인 · 유사도 0.00", score: 0.3, detailKey: null, evidenceText: "a1 로그인" });
  });
  it("세부 내용이 목록이면 세부 항목마다 후보를 내고 detailKey를 붙인다", () => {
    const cat2: CatalogSolution[] = [
      { code: "s1", name: "S1", description: "", isActive: true, sortOrder: 1, features: [
        feat("f-login", "s1", "SSO 로그인", "통합 인증으로 한 번 로그인하면 모든 서비스 이용", ["로그인", "sso"]),
        feat("f-backup", "s1", "백업 스케줄", "볼륨 스냅샷을 스케줄로 백업하고 복구한다", ["백업", "스냅샷"]),
      ] },
    ];
    const idx = buildFeatureIndex(cat2);
    const r: ChunkRequirement = { id: "u", reqId: "SER-010", title: "계정과 백업", categoryName: "c", definition: "", details: "○ 통합 로그인(SSO) 기능 제공\n○ 볼륨 백업 스냅샷 제공" };
    // 근거 문장은 기능 설명에서 뽑으므로 엔진처럼 id → 설명 표를 넘긴다
    const descriptions = new Map(cat2.flatMap((s) => s.features.map((f) => [f.id, f.description] as const)));
    const items = matchRequirement(r, idx, 5, descriptions);
    expect([...new Set(items.map((i) => i.detailKey))]).toEqual(["1", "2"]);
    // 항목마다 그 항목에 맞는 기능이 1순위
    const first = (key: string) => items.find((i) => i.detailKey === key)!;
    expect(first("1").feature).toBe("f-login");
    expect(first("2").feature).toBe("f-backup");
    // 근거 문장은 기능 설명에서 뽑는다
    expect(first("2").evidenceText).toBe("볼륨 스냅샷을 스케줄로 백업하고 복구한다");
  });
  it("세부 내용이 목록이 아니면 예전처럼 요구사항 전체 한 단위(detailKey null)", () => {
    const idx = buildFeatureIndex(manySolutions(1));
    const r: ChunkRequirement = { id: "u", reqId: "SER-011", title: "로그인 기능", categoryName: "c", definition: "", details: "로그인이 되어야 한다" };
    expect(matchRequirement(r, idx).every((i) => i.detailKey === null)).toBe(true);
  });
  it("전체 상한은 기본 5개이고 인자로 1~5까지 바꿀 수 있다(범위 밖은 잘라 쓴다)", () => {
    const idx = buildFeatureIndex(manySolutions(4));
    const r = req("SER-001", "로그인 기능");
    expect(RULES.TOP_PER_REQ).toBe(5);
    expect(matchRequirement(r, idx)).toHaveLength(5);
    expect(matchRequirement(r, idx, 1).map((i) => i.feature)).toEqual(["s1a"]);
    expect(matchRequirement(r, idx, 3)).toHaveLength(3);
    expect(matchRequirement(r, idx, 99)).toHaveLength(5);
    expect(matchRequirement(r, idx, 0)).toHaveLength(1);
    expect(matchChunk([r], idx, 2).map((i) => i.feature)).toEqual(["s1a", "s1b"]);
  });
  it("후보가 없는 요구사항은 행을 내지 않고, 청크는 요구사항 순서대로 이어 붙인다", () => {
    const items = matchChunk([req("SER-001", "통합 인증(SSO) 기능", "한 번 로그인으로 접근"), req("SER-002", "사업 관리 산출물 제출"), req("SER-003", "가상 머신 생성")], index);
    expect(items.filter((i) => i.reqId === "SER-002")).toEqual([]);
    expect(items.filter((i) => i.reqId === "SER-001").map((i) => i.feature)).toEqual(["f-sso", "f-acl"]);
    expect(items.filter((i) => i.reqId === "SER-003")[0].feature).toBe("f-vm");
    expect(items.every((i) => i.verdict === "candidate" && typeof i.score === "number")).toBe(true);
  });
});

describe("evidenceSentence", () => {
  const entry = buildFeatureIndex([{ code: "s", name: "S", description: "", isActive: true, sortOrder: 1, features: [feat("f", "s", "스키마 관리", "", [])] }])[0];
  it("요구 텍스트와 가장 많이 겹치는 문장을 고르고, 중점으로 끊긴 짧은 조각은 쓰지 않는다", () => {
    const req = requirementText({ id: "x", reqId: "SER-001", title: "메시지 스키마를 중앙 저장소에서 관리", categoryName: "c", definition: "", details: "" });
    const desc = "Schema Registry · Repository · 서비스 간 메시지 스키마를 중앙 저장소에서 등록하고 버전으로 관리한다";
    expect(evidenceSentence(req, entry, desc)).toBe("서비스 간 메시지 스키마를 중앙 저장소에서 등록하고 버전으로 관리한다");
  });
  it("쓸 만한 문장이 없으면 설명 전체, 설명이 없으면 기능 이름", () => {
    const req = requirementText({ id: "x", reqId: "SER-001", title: "무관한 요구", categoryName: "c", definition: "", details: "" });
    expect(evidenceSentence(req, entry, "짧은 설명")).toBe("짧은 설명");
    expect(evidenceSentence(req, entry, "")).toBe("스키마 관리");
  });
  it("아주 긴 문장은 잘라 낸다", () => {
    const req = requirementText({ id: "x", reqId: "SER-001", title: "가", categoryName: "c", definition: "", details: "" });
    const out = evidenceSentence(req, entry, "가".repeat(400));
    expect(out.length).toBeLessThanOrEqual(RULES.EVIDENCE_MAX + 1);
    expect(out.endsWith("…")).toBe(true);
  });
});
