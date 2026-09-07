import type { ChunkRequirement } from "./chunk";

/** 판정 5값. 서버·화면·xlsx가 모두 이 상수를 쓴다(4단계 스펙 §5.1). 좋은 판정이 앞. */
export const VERDICTS = ["fulfilled", "partial", "candidate", "build", "na"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_ORDER: readonly Verdict[] = VERDICTS;
export const VERDICT_LABEL: Record<Verdict, string> = {
  fulfilled: "충족",
  partial: "부분충족",
  candidate: "후보",
  build: "설계·구축영역",
  na: "해당없음",
};
export const UNMAPPED_LABEL = "미매핑";
/** Claude 출력 스키마가 허용하는 판정 — candidate는 규칙 엔진 전용이라 뺀다 */
export const LLM_VERDICTS = ["fulfilled", "partial", "build", "na"] as const;

export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/** 충족·부분충족·후보는 솔루션+기능 필수, 설계·구축영역·해당없음은 둘 다 null */
export function requiresFeature(v: Verdict): boolean {
  return v === "fulfilled" || v === "partial" || v === "candidate";
}

/** 매핑·가져오기를 실행하는 엔진. 기본 rules, llm은 ANTHROPIC_API_KEY가 있을 때만 */
export type EngineKind = "rules" | "llm";
export function isEngineKind(v: unknown): v is EngineKind {
  return v === "rules" || v === "llm";
}
/** 매핑 행을 만든 주체(rfp_requirement_mappings.engine) */
export type MappingEngineKind = EngineKind | "manual";
export const ENGINE_LABEL: Record<MappingEngineKind, string> = { rules: "규칙", llm: "Claude", manual: "수동" };

/** 엔진 출력 한 행. feature는 조회 키(llm은 "F3" 별칭, rules는 기능 id) — validateMappingOutput이 FeatureLookup으로 되돌린다 */
export interface EngineItem {
  reqId: string;
  verdict: Verdict;
  feature: string | null;
  rationale: string;
  /** 규칙 엔진 점수 0~1. llm은 없음 */
  score?: number;
  /** 세부 항목 키("1","2"…). null·없음 = 요구사항 전체 단위 */
  detailKey?: string | null;
  /** 판정 근거로 쓴 기능 설명 문장(규칙 엔진이 뽑는다) */
  evidenceText?: string;
}
export type FeatureLookup = Map<string, { featureId: string; solutionCode: string }>;
export type MappingEngine = (chunk: readonly ChunkRequirement[]) => Promise<EngineItem[]>;

/** running 상태가 이만큼 지나면 after()가 죽은 것으로 보고 재실행을 허용한다(1단계 extracting과 같은 6분). */
export const STALE_RUNNING_MS = 6 * 60 * 1000;

export interface CatalogFeature {
  id: string;
  solutionCode: string;
  name: string;
  description: string;
  evidenceUrl: string | null;
  isActive: boolean;
  /** 규칙 엔진 키워드(소문자 NFKC). 클라이언트 toCatalog는 빈 배열 */
  keywords: string[];
  /** 기능을 뽑아낸 소스 문서 제목(Confluence 페이지 제목·xlsx 파일명). 매핑 편집기가 근거 URL 대신 보여준다 */
  sourceTitle?: string | null;
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

/** 매핑 행(순수 함수 입력). API 응답 RfpMapping은 여기에 engine·score·updatedAt·updatedBy를 더한 것. */
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
  /** 세부 항목 키("1","2"…). null = 요구사항 전체 단위 */
  detailKey?: string | null;
  /** 세부 항목 라벨(저장 시점 스냅샷) */
  detailText?: string | null;
  /** 판정 근거 문장(기능 설명에서 뽑은 뒷받침 문장) */
  evidenceText?: string | null;
}
