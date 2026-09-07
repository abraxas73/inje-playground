/** 매핑 실행 대상(스코프). 프로젝트 전체는 undefined, 요구사항·세부 항목 재실행은 이 값을 요청 본문에 넣는다. */
export interface MappingRunTarget {
  requirementIds: string[];
  /** 요구사항 한 건일 때만 의미가 있다. null = 그 요구사항의 모든 세부 항목 */
  detailKey?: string | null;
}
