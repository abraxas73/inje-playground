import { describe, it, expect } from "vitest";
import { normalizeFeatureName, dedupeIncoming, mergeFeatures, FEATURE_NAME_MAX, type ExistingFeature } from "@/lib/rfp/catalog/merge-features";

describe("normalizeFeatureName", () => {
  it("공백·기호·대소문자를 무시하고 괄호 안 내용은 남긴다", () => {
    expect(normalizeFeatureName("SSO (통합 인증)")).toBe(normalizeFeatureName("sso통합인증"));
    expect(normalizeFeatureName("멀티-테넌트 IAM")).toBe("멀티테넌트iam");
  });
});

describe("dedupeIncoming", () => {
  it("같은 이름은 설명이 긴 것을 남기고, 빈 이름은 버리고, 이름은 40자로 자른다", () => {
    const out = dedupeIncoming([
      { name: "SSO", description: "짧음" },
      { name: " sso ", description: "훨씬 더 긴 설명입니다" },
      { name: "", description: "x" },
      { name: "가".repeat(50), description: "d" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ name: "SSO", description: "훨씬 더 긴 설명입니다" });
    expect(out[1].name).toHaveLength(FEATURE_NAME_MAX);
  });
});

describe("mergeFeatures", () => {
  const existing: ExistingFeature[] = [
    { id: "f1", name: "SSO", nameNorm: "sso", edited: false },
    { id: "f2", name: "감사 로그", nameNorm: "감사로그", edited: true },
    { id: "f3", name: "예전 기능", nameNorm: "예전기능", edited: false },
  ];
  it("신규는 insert, 비편집 기존은 update, 편집된 기존은 skippedEdited, 이번에 없는 기존은 건드리지 않는다", () => {
    const plan = mergeFeatures(existing, [
      { name: "SSO", description: "새 설명" },
      { name: "감사로그", description: "덮어쓰기 시도" },
      { name: "백업", description: "신규" },
    ]);
    expect(plan.toInsert).toEqual([{ name: "백업", nameNorm: "백업", description: "신규" }]);
    expect(plan.toUpdate).toEqual([{ id: "f1", description: "새 설명" }]);
    expect(plan.skippedEdited).toEqual(["감사 로그"]);
  });
  it("들어온 목록 안의 중복은 한 번만 처리하고, 빈 이름은 건너뛴다", () => {
    const plan = mergeFeatures([], [{ name: "A", description: "1" }, { name: "a", description: "2" }, { name: "  ", description: "3" }]);
    expect(plan.toInsert).toHaveLength(1);
    expect(plan.toInsert[0].description).toBe("1");
  });
});
