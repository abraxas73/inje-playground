/**
 * 3단계 — SharePoint 등록(스펙 §5). xlsx 다운로드 라우트와 SharePoint 업로드가 같은 buildProjectWorkbook을 써서
 * 같은 바이트·같은 파일명을 만든다. 순수 로직은 fetch/토큰/빌더 주입으로 테스트한다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import { GraphError, uploadFile, type UploadedItem } from "@/lib/ms/graph-drive";
import type { MsAppConfig } from "@/lib/ms/oauth";
import type { ChannelMessage, FetchLike, Notifier } from "@/lib/notify/types";
import type { RfpSharepointUpload, SharepointErrorCode, UploadResponse } from "@/types/rfp";
import { loadCatalog } from "./catalog/store";
import { creatorNames } from "./creators";
import {
  MAPPING_COLUMNS, PROJECT_COLUMNS, SHAREPOINT_UPLOAD_COLUMNS, mapMapping, mapSharepointUpload, parseSharepointFolder, toRequirementRow,
  type MappingDbRow, type ProjectDbRow, type RequirementDbRow, type SharepointUploadDbRow,
} from "./mappers";
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

/** 라우트가 그대로 상태·문구·code로 응답하는 오류(스펙 §7·§9) */
export class SharepointFlowError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: SharepointErrorCode) {
    super(message);
    this.name = "SharepointFlowError";
  }
}

/** Teams 채널 알림 문구(스펙 §5.2 6) */
export function buildUploadNotice(p: { projectName: string; userName: string; folderName: string; fileName: string; webUrl: string }): ChannelMessage {
  return {
    title: "RFP 분석",
    text: `[RFP] ${p.projectName} 요구사항 검토 파일을 SharePoint에 올렸습니다 — ${p.userName} · ${p.folderName}\n${p.fileName}\n${p.webUrl}`,
  };
}

/** Graph 업로드 실패 → 스펙 §9 상태·문구 */
export function mapGraphUploadError(e: unknown): SharepointFlowError {
  if (e instanceof GraphError) {
    if (e.status === 403) return new SharepointFlowError(403, "이 폴더에 쓸 권한이 없습니다.");
    if (e.status === 404) return new SharepointFlowError(404, "폴더가 없습니다(삭제·이동). 링크를 다시 지정하세요.");
    if (e.status === 423) return new SharepointFlowError(409, "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요.");
    return new SharepointFlowError(502, `SharePoint 응답 오류(${e.status})`);
  }
  return new SharepointFlowError(502, e instanceof Error ? e.message : "SharePoint 업로드 실패");
}

export interface UploadFlowDeps {
  app: MsAppConfig;
  encKey: Buffer;
  notifier: Notifier;
  /** 알림 문구·이력 표시용 업로더 이름 */
  userName: string;
  fetchImpl?: FetchLike;
  now?: () => Date;
  /** 테스트 주입용 — 기본은 실제 구현 */
  getToken?: typeof getAccessTokenForUser;
  build?: typeof buildProjectWorkbook;
  upload?: typeof uploadFile;
}

/**
 * 업로드 절차(스펙 §5.2): 프로젝트 검사 → 사용자 토큰 → 워크북 → Graph 업로드(replace) → 이력 insert → Teams 알림(실패해도 성공).
 * 사용자에게 보여줄 실패는 SharepointFlowError, 그 외(OAuthError·DB 오류)는 그대로 던진다.
 */
export async function uploadProjectXlsx(admin: SupabaseClient, projectId: string, userId: string, deps: UploadFlowDeps): Promise<UploadResponse> {
  const getToken = deps.getToken ?? getAccessTokenForUser;
  const build = deps.build ?? buildProjectWorkbook;
  const upload = deps.upload ?? uploadFile;
  const now = deps.now ?? (() => new Date());

  const { data, error } = await admin.from("rfp_projects").select(PROJECT_COLUMNS).eq("id", projectId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new SharepointFlowError(404, "프로젝트가 없습니다.");
  const row = data as ProjectDbRow;
  if (row.status !== "ready") throw new SharepointFlowError(400, "요구사항 추출이 끝난 뒤 업로드할 수 있습니다.");
  const folder = parseSharepointFolder(row.sharepoint_folder);
  if (!folder) throw new SharepointFlowError(400, "SharePoint 폴더가 지정되지 않았습니다.", "no_folder");

  let token: string;
  try {
    token = await getToken(admin, userId, { app: deps.app, encKey: deps.encKey, fetchImpl: deps.fetchImpl });
  } catch (e) {
    if (e instanceof NotConnectedError) throw new SharepointFlowError(400, e.message, "not_connected");
    if (e instanceof ReconnectRequiredError) throw new SharepointFlowError(409, e.message, "reconnect");
    throw e;
  }

  const { buffer, fileName } = await build(admin, row, now());

  let item: UploadedItem;
  try {
    item = await upload(token, { driveId: folder.driveId, itemId: folder.itemId, fileName, buffer }, deps.fetchImpl ?? fetch);
  } catch (e) {
    if (e instanceof GraphError) console.error(`[rfp] SharePoint 업로드 실패 project=${projectId} status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
    throw mapGraphUploadError(e);
  }

  const { data: ins, error: insErr } = await admin
    .from("rfp_sharepoint_uploads")
    .insert({ project_id: projectId, drive_id: folder.driveId, item_id: item.id, file_name: item.name || fileName, web_url: item.webUrl, size_bytes: item.size || buffer.length, uploaded_by: userId })
    .select(SHAREPOINT_UPLOAD_COLUMNS)
    .single();
  if (insErr) throw new Error(`업로드 이력 저장 실패: ${insErr.message}`);
  const uploadRow = mapSharepointUpload(ins as SharepointUploadDbRow, deps.userName);

  let notified = false;
  let notifyError: string | undefined;
  if (deps.notifier.channelConfigured) {
    const r = await deps.notifier.sendChannel(buildUploadNotice({ projectName: row.name, userName: deps.userName, folderName: folder.name, fileName: uploadRow.fileName, webUrl: uploadRow.webUrl }));
    if (r.ok) notified = true;
    else notifyError = r.error ?? "알림 실패";
  }
  return notifyError ? { upload: uploadRow, notified, notifyError } : { upload: uploadRow, notified };
}

/** 최근 업로드 이력(최신순). 업로더 이름은 user_profiles에서 붙인다. */
export async function loadUploads(admin: SupabaseClient, projectId: string, limit = 20): Promise<RfpSharepointUpload[]> {
  const { data, error } = await admin.from("rfp_sharepoint_uploads").select(SHAREPOINT_UPLOAD_COLUMNS).eq("project_id", projectId).order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as SharepointUploadDbRow[];
  const names = await creatorNames(admin, rows.map((r) => r.uploaded_by).filter((v): v is string => !!v));
  return rows.map((r) => mapSharepointUpload(r, r.uploaded_by ? names.get(r.uploaded_by) ?? null : null));
}
