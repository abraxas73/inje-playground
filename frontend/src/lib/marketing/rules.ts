import type { ContactData, Validation } from "./types";
import { dbCheck, MarketingError, type marketingAuth } from "./server";
export interface RuleViolation { id: string; code: string; version: number; title: string; message: string; severity: "error" | "warning"; manual: boolean; field?: string }
export interface RuleCheck { version: string; rules: unknown[]; violations: RuleViolation[] }
export async function applyRules(db: Awaited<ReturnType<typeof marketingAuth>>["db"], data: ContactData, validation: Validation) {
  const result = await db.rpc("marketing_validate_rules", { p_data: data }); dbCheck(result.error);
  const check = result.data as RuleCheck;
  if (!check?.version || !Array.isArray(check.violations) || !Array.isArray(check.rules)) throw new MarketingError("관리 규칙을 불러오지 못했습니다. 다시 검증해 주세요.", 503);
  validation.ruleCheck = check;
  validation.ruleVersion += ` / DB:${check.version}`;
  for (const violation of check.violations) {
    if (violation.severity === "error") validation.errors.push(`[${violation.code} v${violation.version}] ${violation.message}`);
    else validation.reasons.push(`[담당자 확인 · ${violation.code} v${violation.version}] ${violation.message}`);
  }
  if (check.violations.some(v => !v.manual)) validation.kind = "확인 필요";
  return validation;
}
