import { NextRequest } from "next/server";
import { cleanData } from "@/lib/marketing/validation";
import { dbCheck, failure, marketingAuth, response } from "@/lib/marketing/server";
export async function GET() {
  try {
    const { db, reviewer } = await marketingAuth();
    const [rules, history, drafts] = await Promise.all([
      db.from("marketing_rules").select("*").order("code"),
      db.from("marketing_rule_versions").select("*").order("created_at", { ascending: false }).limit(500),
      db.from("marketing_rule_drafts").select("*").is("published_version", null).order("updated_at", { ascending: false }),
    ]);
    dbCheck(rules.error); dbCheck(history.error); dbCheck(drafts.error);
    return response({ rules: rules.data, versions: history.data, drafts: drafts.data, editable: reviewer });
  } catch (e) { return failure(e); }
}
export async function POST(req: NextRequest) {
  try {
    const { db } = await marketingAuth(true); const b = await req.json();
    if (b.action === "preview") {
      const result = await db.rpc("marketing_validate_rules", { p_data: cleanData(b.data) }); dbCheck(result.error); return response(result.data);
    }
    if (b.action === "draft" || b.action === "publish") {
      const result = await db.rpc("marketing_edit_rule", { p_draft_id: b.draftId, p_revision: b.revision, p_rule_id: b.ruleId || null, p_base_version: b.baseVersion || null, p_definition: b.definition, p_reason: b.reason, p_publish: b.action === "publish" });
      dbCheck(result.error); return response(result.data);
    }
    if (b.action !== "save") throw new Error("지원하지 않는 규칙 작업입니다.");
    const result = await db.rpc("marketing_save_rule", { p_id: b.id || null, p_version: b.version ?? null, p_title: b.title, p_description: b.description ?? "", p_config: b.config, p_severity: b.severity, p_enabled: b.enabled, p_reason: b.reason });
    dbCheck(result.error); return response({ rule: result.data });
  } catch (e) { return failure(e); }
}
