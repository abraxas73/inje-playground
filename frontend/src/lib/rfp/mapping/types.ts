/** 판정 4값. 서버·화면·xlsx가 모두 이 상수를 쓴다(스펙 §4.2). */
export const VERDICTS = ["fulfilled", "partial", "build", "na"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_ORDER: readonly Verdict[] = VERDICTS;
export const VERDICT_LABEL: Record<Verdict, string> = {
  fulfilled: "충족",
  partial: "부분충족",
  build: "설계·구축영역",
  na: "해당없음",
};
export const UNMAPPED_LABEL = "미매핑";

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/** 충족·부분충족은 솔루션+기능 필수, 설계·구축영역·해당없음은 둘 다 null */
export function requiresFeature(v: Verdict): boolean {
  return v === "fulfilled" || v === "partial";
}

/** running 상태가 이만큼 지나면 after()가 죽은 것으로 보고 재실행을 허용한다(1단계 extracting과 같은 6분). */
export const STALE_RUNNING_MS = 6 * 60 * 1000;

export interface CatalogFeature {
  id: string;
  solutionCode: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
}

export interface CatalogSolution {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
  sortOrder: number;
  /** 비활성 기능도 포함(매핑이 참조하는 이름을 그려야 함). 활성만 필요하면 호출 쪽에서 거른다. */
  features: CatalogFeature[];
}

/** 매핑 행(순수 함수 입력). API 응답 RfpMapping은 여기에 updatedAt·updatedBy를 더한 것. */
export interface MappingRow {
  id: string;
  requirementId: string;
  solutionCode: string | null;
  featureId: string | null;
  verdict: Verdict;
  rationale: string;
  evidenceUrl: string | null;
  edited: boolean;
  sortOrder: number;
}
