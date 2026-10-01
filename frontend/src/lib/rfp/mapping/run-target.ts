/** 매핑 실행 대상(스코프). 프로젝트 전체는 undefined, 요구사항·세부 항목 재실행은 이 값을 요청 본문에 넣는다. */
export interface MappingRunTarget {
  requirementIds: string[];
  /** null = 요구사항 전체. 세분화된 상위 키 = 해당 하위 항목 전체, 하위 키 = 개별 항목. */
  detailKey?: string | null;
}
