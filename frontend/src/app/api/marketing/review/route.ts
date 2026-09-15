import { NextRequest } from "next/server";
import { cleanData, mergeUpdate, validateContact } from "@/lib/marketing/validation";
import { dbCheck, failure, marketingAuth, response, snapshot } from "@/lib/marketing/server";
import { recommendCompany } from "@/lib/marketing/ai";
import { visibleData, type Submission } from "@/lib/marketing/types";
import { applyRules } from "@/lib/marketing/rules";

export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true);
    const b = await req.json();
    if (b.action === "check") {
      const checked = await db.rpc("marketing_review_check", { p_id: b.id, p_final: { ...cleanData(b.final), category: b.category || "확인 필요" }, p_target: b.targetId || null, p_org: b.organizationId || null }); dbCheck(checked.error); return response(checked.data);
    }
    if (b.action === "inspect") {
      const row = await db.from("marketing_submissions").select("*").eq("id", b.id).single(); dbCheck(row.error);
      let s = row.data as Submission;
      const { contacts, organizations } = await snapshot(db);
      const validation = validateContact(s.data, contacts, organizations, s.target_id, s.clear_fields);
      validation.ai = b.ai ? await recommendCompany(s.data, organizations.filter(o => validation.organizationIds.includes(o.id))) : s.validation.ai;
      const target = contacts.find(c => c.id === s.target_id);
      await applyRules(db, target ? mergeUpdate(visibleData(target), s.data, s.clear_fields) : s.data, validation);
      const duplicate = await db.rpc("marketing_pending_duplicate", { p_data: target ? mergeUpdate(visibleData(target), s.data, s.clear_fields) : s.data, p_exclude: s.id }); dbCheck(duplicate.error);
      if (duplicate.data) { if (!validation.errors.length && !validation.ruleCheck?.violations.some(v => !v.manual)) validation.kind = "중복 의심"; validation.reasons.push("다른 검수 대기 제출과 겹치는 정보가 있습니다."); }
      if (s.status === "pending" || s.status === "validating") {
        const saved = await db.rpc("marketing_revalidate", { p_id: s.id, p_version: s.version, p_validation: validation }); dbCheck(saved.error);
        s = saved.data as Submission;
      }
      const candidateIds = [...new Set([...validation.candidates, ...(b.targetId ? [b.targetId] : [])])];
      return response({ submission: s, validation, contacts: contacts.filter(c => candidateIds.includes(c.id)), organizations: organizations.filter(o => o.id === s.submitted_organization_id || validation.organizationIds.includes(o.id) || validation.ai.organizationId === o.id || contacts.some(c => candidateIds.includes(c.id) && c.organization_id === o.id)) });
    }
    const result = await db.rpc("marketing_review", { p_id: b.id, p_version: b.version, p_action: b.action, p_final: b.action === "reject" ? {} : cleanData(b.final), p_target: b.targetId || null, p_target_version: b.targetVersion ?? null, p_org: b.organizationId || null, p_org_version: b.organizationVersion ?? null, p_category: b.category || "확인 필요", p_reason: b.reason, p_resolution: b.resolution ?? null });
    dbCheck(result.error); return response({ contactId: result.data });
  } catch (e) { return failure(e); }
}
