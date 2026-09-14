import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { dbCheck, failure, marketingAuth, response, snapshot } from "@/lib/marketing/server";
import { cleanData, mergeUpdate, validateContact } from "@/lib/marketing/validation";
import { recommendCompany } from "@/lib/marketing/ai";
import { FIELDS, visibleData, type SubmissionResult } from "@/lib/marketing/types";
import { applyRules } from "@/lib/marketing/rules";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(); const body = await req.json();
    if (!Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 50) throw new Error("한 번에 1~50건을 제출해 주세요.");
    const { contacts, organizations } = await snapshot(db);
    const results: SubmissionResult[] = [];
    // Commit each row independently; stable request keys make a retry safe after connection loss.
    for (let index = 0; index < body.rows.length; index++) {
      const r = body.rows[index];
      try {
        const data = cleanData(r.data); const clearFields = Array.isArray(r.clearFields) ? r.clearFields : [];
        if (clearFields.some((k: unknown) => typeof k !== "string" || !(k in FIELDS))) throw new Error("삭제 필드가 올바르지 않습니다.");
        if (r.requestKey && (typeof r.requestKey !== "string" || !/^[a-f\d-]{36}$/i.test(r.requestKey))) throw new Error("요청 키가 올바르지 않습니다.");
        if (JSON.stringify(r.source ?? {}).length > 100000) throw new Error("원본 출처 정보가 너무 큽니다.");
        const target = r.dbId ? contacts.find(c => c.db_id === r.dbId) : r.targetId ? contacts.find(c => c.id === r.targetId) : null;
        if ((r.dbId || r.targetId) && !target) throw new Error("지정한 DB ID를 찾을 수 없습니다. 기존 ID를 확인해 주세요.");
        const requestKey = r.requestKey || randomUUID();
        const validation = validateContact(data, contacts, organizations, target?.id ?? null, clearFields,
          body.rows.filter((_: unknown, i: number) => i !== index).map((x: { data: unknown }) => { try { return cleanData(x.data); } catch { return null; } }).filter(Boolean));
        const initial = await db.rpc("marketing_submit", { p_rows: [{ data, targetId: target?.id ?? null, clearFields, requestKey, source: { ...r.source, submittedData: r.data, submittedDbId: r.dbId ?? null }, processing: true, validation: { ...validation, reasons: ["검증 중 · 중단된 경우 검수 화면에서 다시 검증할 수 있습니다."] } }] }); dbCheck(initial.error);
        const id = initial.data[0] as string;
        // The check includes pending/processing rows but excludes this request itself.
        const checked = await applyRules(db, target ? mergeUpdate(visibleData(target), data, clearFields) : data, validation);
        const duplicate = await db.rpc("marketing_pending_duplicate", { p_data: target ? mergeUpdate(visibleData(target), data, clearFields) : data, p_exclude: id }); dbCheck(duplicate.error);
        if (duplicate.data) { if (!checked.errors.length && !checked.ruleCheck?.violations.some(v => !v.manual)) checked.kind = "중복 의심"; checked.reasons.push("다른 검수 대기 제출과 이메일 또는 회사·성명이 겹칩니다."); }
        if (!checked.organizationIds.length || checked.reasons.some(x => x.startsWith("유사 회사명"))) checked.ai = await recommendCompany(data, organizations.filter(o => checked.organizationIds.includes(o.id)));
        const saved = await db.rpc("marketing_finish_validation", { p_id: id, p_validation: checked }); dbCheck(saved.error);
        results.push({ index, row: r.source?.row ?? index + 1, status: "submitted", id, requestKey, kind: checked.kind, validationErrors: checked.errors });
      } catch (e) { results.push({ index, row: r?.source?.row ?? index + 1, status: "error", error: e instanceof Error ? e.message : "제출 실패" }); }
    }
    if (!body.partial && results.length === 1 && results[0].status === "error") throw new Error(results[0].error);
    return response({ results, count: results.filter(r => r.status === "submitted").length, failed: results.filter(r => r.status === "error").length });
  } catch (e) { return failure(e); }
}
