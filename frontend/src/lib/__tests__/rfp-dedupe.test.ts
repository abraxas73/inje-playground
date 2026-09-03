import { describe, it, expect } from "vitest";
import { decideDuplicate, bigramDice, type ExistingProject } from "@/lib/rfp/dedupe";
import { normalizeName, nameCore, normalizeAgency } from "@/lib/rfp/overview";

const knoc: ExistingProject = {
  id: "p1", name: "생성형 AI 플랫폼 구축 및 AX 개발 사업", agency: "한국석유공사",
  nameNorm: normalizeName("생성형 AI 플랫폼 구축 및 AX 개발 사업"), agencyNorm: normalizeAgency("한국석유공사"),
  fileHashes: ["aaa"], createdAt: "2026-09-01T00:00:00Z",
};
const other: ExistingProject = {
  id: "p2", name: "차세대 인사시스템 구축", agency: "한국도로공사",
  nameNorm: normalizeName("차세대 인사시스템 구축"), agencyNorm: normalizeAgency("한국도로공사"),
  fileHashes: ["bbb"], createdAt: "2026-08-01T00:00:00Z",
};
const input = (name: string, agency: string | null, sha256 = "zzz") => ({
  sha256, nameNorm: normalizeName(name), nameCore: nameCore(name), agencyNorm: agency ? normalizeAgency(agency) : null,
});

describe("bigramDice", () => {
  it("같으면 1, 겹치는 바이그램이 없으면 0", () => {
    expect(bigramDice("abcd", "abcd")).toBe(1);
    expect(bigramDice("abcd", "wxyz")).toBe(0);
    expect(bigramDice("abcd", "abce")).toBeCloseTo(2 * 2 / 6, 5);
    expect(bigramDice("a", "a")).toBe(1);
    expect(bigramDice("a", "b")).toBe(0);
  });
});

describe("decideDuplicate", () => {
  it("파일 해시가 같으면 중복", () => {
    expect(decideDuplicate(input("완전히 다른 이름", "다른 기관", "aaa"), [knoc, other])).toEqual({ kind: "duplicate", projectId: "p1", reason: "hash" });
  });
  it("정규화한 사업명+발주기관이 같으면 중복(괄호·공백·재공고 아님)", () => {
    expect(decideDuplicate(input("생성형AI 플랫폼 구축 및 AX개발 사업", "한국석유공사(KNOC)"), [knoc, other])).toEqual({ kind: "duplicate", projectId: "p1", reason: "name_agency" });
  });
  it("사업명은 같은데 발주기관이 다르면 사용자 확인", () => {
    const r = decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업", "한국가스공사"), [knoc, other]);
    expect(r.kind).toBe("needsConfirm");
    if (r.kind === "needsConfirm") expect(r.candidates.map((c) => c.id)).toEqual(["p1"]);
  });
  it("발주기관을 못 뽑았고 사업명이 같으면 사용자 확인", () => {
    expect(decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업", null), [knoc, other]).kind).toBe("needsConfirm");
  });
  it("재공고처럼 접미 단어만 다르면 사용자 확인", () => {
    expect(decideDuplicate(input("생성형 AI 플랫폼 구축 및 AX 개발 사업 재공고", "한국석유공사"), [knoc, other]).kind).toBe("needsConfirm");
  });
  it("비슷하지 않으면 신규", () => {
    expect(decideDuplicate(input("스마트 항로표지 유지관리 용역", "해양수산부"), [knoc, other])).toEqual({ kind: "new" });
    expect(decideDuplicate(input("아무 사업", null), [])).toEqual({ kind: "new" });
  });
});
