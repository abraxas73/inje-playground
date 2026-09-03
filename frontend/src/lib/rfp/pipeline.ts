import type { SupabaseClient } from "@supabase/supabase-js";
import { UnsupportedDocumentError, type DocumentFormat, type DocumentModel } from "./document-model";
import { detectFormat, parseDocument } from "./parse";
import { extractOverview, nameCore, normalizeAgency, normalizeName, type Overview } from "./overview";
import { decideDuplicate, type ExistingProject } from "./dedupe";
import { extractStandard, isStandardFormat, type ExtractionResult } from "./extract-standard";
import { createAnthropicExtractCall, extractWithLlm, LlmUnavailableError } from "./extract-llm";

export const RFP_BUCKET = "rfp";

export async function downloadFile(admin: SupabaseClient, storagePath: string): Promise<Buffer> {
  const { data, error } = await admin.storage.from(RFP_BUCKET).download(storagePath);
  if (error || !data) throw new Error(`파일을 내려받을 수 없습니다: ${error?.message ?? storagePath}`);
  return Buffer.from(await data.arrayBuffer());
}

export interface RegisterInput {
  storagePath: string;
  fileName: string;
  sha256: string;
  sizeBytes: number;
  force: boolean;
  userId: string;
}

export type RegisterResult =
  | { kind: "duplicate"; projectId: string }
  | { kind: "needsConfirm"; candidates: ExistingProject[]; overview: Overview & { name: string } }
  | { kind: "created"; projectId: string }
  | { kind: "error"; status: number; message: string };

/** 중복 판단용 기존 프로젝트 목록(프로젝트는 수백 건 이하라 1000행 상한 걱정 없음) */
async function loadExisting(admin: SupabaseClient): Promise<ExistingProject[]> {
  const { data: projects, error } = await admin.from("rfp_projects").select("id, name, agency, name_norm, agency_norm, created_at");
  if (error) throw new Error(error.message);
  const { data: files, error: fe } = await admin.from("rfp_files").select("project_id, sha256");
  if (fe) throw new Error(fe.message);
  const hashes = new Map<string, string[]>();
  for (const f of files ?? []) hashes.set(f.project_id, [...(hashes.get(f.project_id) ?? []), f.sha256]);
  return (projects ?? []).map((p) => ({
    id: p.id, name: p.name, agency: p.agency, nameNorm: p.name_norm, agencyNorm: p.agency_norm,
    fileHashes: hashes.get(p.id) ?? [], createdAt: p.created_at,
  }));
}

async function removeUpload(admin: SupabaseClient, storagePath: string) {
  await admin.storage.from(RFP_BUCKET).remove([storagePath]).catch(() => undefined);
}

/**
 * 스펙 §2·§5. 파일 내려받기 → 파싱 → 개요 → 중복 판단 → 프로젝트·파일 행 생성(status extracting).
 * 추출은 하지 않는다(라우트가 after()로 runExtraction을 호출).
 */
export async function registerProject(admin: SupabaseClient, input: RegisterInput): Promise<RegisterResult> {
  let buf: Buffer;
  try {
    buf = await downloadFile(admin, input.storagePath);
  } catch (e) {
    return { kind: "error", status: 400, message: e instanceof Error ? e.message : "파일을 내려받을 수 없습니다." };
  }

  let doc: DocumentModel;
  let format: DocumentFormat;
  try {
    format = detectFormat(buf, input.fileName);
    doc = parseDocument(buf, input.fileName);
  } catch (e) {
    await removeUpload(admin, input.storagePath);
    if (e instanceof UnsupportedDocumentError) return { kind: "error", status: 415, message: e.message };
    console.error("[rfp] parse failed", input.fileName, e);
    return { kind: "error", status: 400, message: "문서를 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식입니다." };
  }

  const overview = extractOverview(doc);
  const warnings: string[] = [];
  const name = overview.name ?? input.fileName.replace(/\.[^.]+$/, "");
  if (!overview.name) warnings.push("사업명을 문서에서 찾지 못해 파일명을 사용했습니다. 개요에서 수정하세요.");
  const nameNorm = normalizeName(name);
  const agencyNorm = overview.agency ? normalizeAgency(overview.agency) : null;

  const existing = await loadExisting(admin);
  const decision = decideDuplicate({ sha256: input.sha256, nameNorm, nameCore: nameCore(name), agencyNorm }, existing);
  if (decision.kind === "duplicate") {
    await removeUpload(admin, input.storagePath);
    return { kind: "duplicate", projectId: decision.projectId };
  }
  if (decision.kind === "needsConfirm" && !input.force) {
    return { kind: "needsConfirm", candidates: decision.candidates, overview: { ...overview, name } };
  }

  const { data: project, error } = await admin
    .from("rfp_projects")
    .insert({
      name, agency: overview.agency, period: overview.period, budget: overview.budget, bid_method: overview.bidMethod,
      extra: overview.extra, name_norm: nameNorm, agency_norm: agencyNorm, status: "extracting", warnings,
      created_by: input.userId, updated_by: input.userId,
    })
    .select("id")
    .single();
  if (error || !project) {
    if (error?.code === "23505") {
      // 동시 등록 경쟁: 유니크 인덱스에 걸렸으면 그 프로젝트로 안내
      const { data: dup } = await admin.from("rfp_projects").select("id").eq("name_norm", nameNorm).eq("agency_norm", agencyNorm ?? "").maybeSingle();
      await removeUpload(admin, input.storagePath);
      if (dup) return { kind: "duplicate", projectId: dup.id };
    }
    return { kind: "error", status: 500, message: error?.message ?? "프로젝트 저장에 실패했습니다." };
  }

  const { error: fe } = await admin.from("rfp_files").insert({
    project_id: project.id, storage_path: input.storagePath, original_filename: input.fileName, format,
    size_bytes: input.sizeBytes, sha256: input.sha256, uploaded_by: input.userId,
  });
  if (fe) {
    await admin.from("rfp_projects").delete().eq("id", project.id);
    await removeUpload(admin, input.storagePath);
    if (fe.code === "23505") {
      const dup = existing.find((p) => p.fileHashes.includes(input.sha256));
      if (dup) return { kind: "duplicate", projectId: dup.id };
    }
    return { kind: "error", status: 500, message: fe.message };
  }
  return { kind: "created", projectId: project.id };
}

/**
 * 스펙 §6·§8. 원본을 다시 파싱해 요구사항을 추출하고 rfp_requirements를 교체한다.
 * 어떤 경우에도 status를 ready 또는 failed로 끝낸다.
 */
export async function runExtraction(admin: SupabaseClient, projectId: string): Promise<void> {
  const fail = async (message: string) => {
    await admin.from("rfp_projects").update({ status: "failed", error: message.slice(0, 500) }).eq("id", projectId);
  };
  try {
    const { data: file } = await admin
      .from("rfp_files")
      .select("storage_path, original_filename")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!file) return await fail("원본 파일이 없습니다.");

    const buf = await downloadFile(admin, file.storage_path);
    const doc = parseDocument(buf, file.original_filename);

    let result: ExtractionResult;
    if (isStandardFormat(doc)) {
      result = extractStandard(doc);
    } else {
      let call;
      try {
        call = createAnthropicExtractCall();
      } catch (e) {
        if (e instanceof LlmUnavailableError) return await fail(`표준 양식이 아니며 LLM 키가 설정되지 않았습니다(${e.message}).`);
        throw e;
      }
      result = await extractWithLlm(doc, call);
    }

    const { error: de } = await admin.from("rfp_requirements").delete().eq("project_id", projectId);
    if (de) throw new Error(de.message);
    const rows = result.requirements.map((r) => ({
      project_id: projectId, category_code: r.categoryCode, category_name: r.categoryName, req_id: r.reqId,
      title: r.title, definition: r.definition, details: r.details, deliverables: r.deliverables, related: r.related,
      sort_order: r.sortOrder, source: r.source,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await admin.from("rfp_requirements").insert(rows.slice(i, i + 200));
      if (error) throw new Error(error.message);
    }

    const { data: proj } = await admin.from("rfp_projects").select("warnings").eq("id", projectId).single();
    const registerWarnings = (Array.isArray(proj?.warnings) ? (proj!.warnings as string[]) : []).filter((w) => w.startsWith("사업명을"));
    await admin
      .from("rfp_projects")
      .update({
        status: "ready", error: null, extraction_method: result.method,
        warnings: [...registerWarnings, ...result.warnings], requirement_count: result.requirements.length,
      })
      .eq("id", projectId);
  } catch (e) {
    console.error("[rfp] extraction failed", projectId, e);
    await fail(e instanceof Error ? e.message : String(e));
  }
}
