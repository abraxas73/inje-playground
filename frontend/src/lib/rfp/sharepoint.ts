/**
 * 3단계 — SharePoint 등록(스펙 §5). xlsx 다운로드 라우트와 SharePoint 업로드가 같은 buildProjectWorkbook을 써서
 * 같은 바이트·같은 파일명을 만든다. 순수 로직은 fetch/토큰/빌더 주입으로 테스트한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCatalog } from "./catalog/store";
import { MAPPING_COLUMNS, mapMapping, toRequirementRow, type MappingDbRow, type ProjectDbRow, type RequirementDbRow } from "./mappers";
import { buildWorkbook, xlsxFileName, type XlsxMapping, type XlsxProject } from "./xlsx";
import { selectAll } from "../work-metrics/common";

/** 프로젝트 행 → 요구사항·매핑·카탈로그를 읽어 워크북 버퍼와 파일명(KST 날짜). 실패는 Error(라우트가 500). */
export async function buildProjectWorkbook(admin: SupabaseClient, project: ProjectDbRow, now: Date = new Date()): Promise<{ buffer: Buffer; fileName: string }> {
  const { data: reqs, error } = await admin.from("rfp_requirements").select("*").eq("project_id", project.id).order("sort_order");
  if (error) throw new Error(error.message);

  const mapsRes = await selectAll<MappingDbRow>(() =>
    admin.from("rfp_requirement_mappings").select(MAPPING_COLUMNS, { count: "exact" }).eq("project_id", project.id).order("sort_order").order("id"),
  );
  if (mapsRes.error) throw new Error(mapsRes.error.message);

  // 매핑 행이 있거나 매핑을 한 번이라도 실행했으면(수동 행만 있어도) 매핑 열·시트를 넣는다(2단계 최종 리뷰 반영).
  let mapping: XlsxMapping | undefined;
  if (mapsRes.data.length > 0 || project.mapping_status !== "none") {
    const catalog = await loadCatalog(admin);
    mapping = { rows: mapsRes.data.map(mapMapping), catalog, mappingAt: project.mapping_at };
  }

  const xlsxProject: XlsxProject = { name: project.name, agency: project.agency, period: project.period, budget: project.budget, bidMethod: project.bid_method, extra: project.extra ?? {} };
  const buffer = await buildWorkbook(xlsxProject, ((reqs ?? []) as RequirementDbRow[]).map(toRequirementRow), mapping);
  return { buffer, fileName: xlsxFileName(xlsxProject, now) };
}
