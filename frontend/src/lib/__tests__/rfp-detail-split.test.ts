import { describe, it, expect } from "vitest";
import { parseDetailUnits, splitDetailChildren, readDetailSplits } from "@/lib/rfp/mapping/detail-items";
import { groupRowsByDetail } from "@/lib/rfp/mapping/detail-groups";
import { buildChunkMessage } from "@/lib/rfp/mapping/prompt";
import { validateMappingOutput, assertCompleteLlmMapping } from "@/lib/rfp/mapping/validate";
import { mapRequirement, toRequirementRow, type RequirementDbRow } from "@/lib/rfp/mappers";
import type { MappingRow } from "@/lib/rfp/mapping/types";
const details = "ㅇ 수량 6식\nㅇ HCI 관리도구\n  - 영구 라이선스\n    ※ 구독은 10년 이상\n  - VM 관리\n    - 생성\n    - 삭제\nㅇ 제조사 지원";
const parent = parseDetailUnits(details).units[1];
const detailSplits = { "2": parent.text };
describe("선택한 상위 항목 세분화", () => {
 it("선택한 대시만 분리하며 주석과 더 깊은 목록, 상위 문맥을 보존", () => {
  const result=parseDetailUnits(details, detailSplits);
  expect(result.units.map(u=>u.key)).toEqual(["1","2.1","2.2","3"]);
  expect(result.units[1].label).toBe("영구 라이선스");
  expect(result.units[1].text).toBe("ㅇ HCI 관리도구\n  - 영구 라이선스\n    ※ 구독은 10년 이상");
  expect(result.units[2].text).toContain("    - 생성\n    - 삭제");
  expect(result.retiredKeys).toEqual(["2"]);
 });
 it("주석만 있거나 하위 항목이 하나면 분리하지 않음", () => {
  expect(splitDetailChildren({...parent,text:"ㅇ 제목\n- 하나\n※ 주석"})).toEqual([]);
 });
 it("한 상위 항목만 있는 요구사항도 하위별 매핑 가능", () => {
  const p=parseDetailUnits(parent.text).units[0];
  const result=parseDetailUnits(parent.text,{"1":p.text});
  expect(result.flat).toBe(false);
  expect(result.units.map(u=>u.key)).toEqual(["1.1","1.2"]);
  expect(result.retiredKeys).toContain("");
 });
 it("원문 변경 시 오래된 분할 설정을 적용하지 않음", () => {
  expect(parseDetailUnits(details.replace("영구", "기간제"),detailSplits).units.map(u=>u.key)).toEqual(["1","2","3"]);
 });
 it("상위 매핑은 별도 보존하고 하위 항목은 미매핑으로 시작", () => {
  const row={id:"m",requirementId:"r",detailKey:"2",detailText:"HCI 관리도구",sortOrder:1} as MappingRow;
  const groups=groupRowsByDetail([row],parseDetailUnits(details,detailSplits));
  expect(groups.find(g=>g.key==="2")?.archived).toBe(true);
  expect(groups.find(g=>g.key==="2.1")?.rows).toEqual([]);
 });
 it("저장 메타데이터를 API 및 엑셀 입력에 전달", () => {
  const row={source:{blockIndex:12,detailSplits}} as RequirementDbRow;
  expect(mapRequirement(row).detailSplits).toEqual(detailSplits);
  expect(toRequirementRow(row).detailSplits).toEqual(detailSplits);
  expect(readDetailSplits({detailSplits:{bad:true,"1":"text"}})).toEqual({"1":"text"});
 });
 it("Claude 프롬프트와 출력 검증도 하위 키를 사용", () => {
  const req={id:"r",reqId:"ECR-003",title:"HCI",categoryName:"장비",definition:"",details,detailSplits};
  expect(buildChunkMessage([req])).toContain("2.1");
  const result=validateMappingOutput(parseDetailUnits(details,detailSplits).units.map(u=>({reqId:"ECR-003",detailKey:u.key,verdict:"build" as const,feature:null,rationale:"구축"})),[req],new Map());
  expect(result.rows.map(r=>r.detailKey)).toContain("2.2");
  expect(()=>assertCompleteLlmMapping(result.rows,[req])).not.toThrow();
 });
});
