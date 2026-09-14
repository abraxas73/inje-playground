import { CATEGORIES, FIELDS, companyKey, emailKey, emptyContact, visibleData, type Contact, type ContactData, type Field, type Organization, type Validation } from "./types";

export function cleanData(value: unknown): ContactData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Contact 입력 형식이 올바르지 않습니다.");
  const result = emptyContact();
  for (const key of Object.keys(FIELDS) as Field[]) {
    const v = (value as Record<string, unknown>)[key];
    if (v != null && typeof v !== "string") throw new Error(`${FIELDS[key]}는 문자로 입력해 주세요.`);
    if (typeof v === "string" && v.length > 2000) throw new Error(`${FIELDS[key]}는 2,000자 이하여야 합니다.`);
    result[key] = typeof v === "string" ? v.trim() : "";
  }
  return result;
}
export function mergeUpdate(old: ContactData, incoming: ContactData, clear: Field[] = []): ContactData {
  return Object.fromEntries((Object.keys(FIELDS) as Field[]).map(k => [k, clear.includes(k) ? "" : incoming[k] || old[k] || ""])) as ContactData;
}
/** Structural limits only. Business field checks come from the applied DB rule versions. */
export function fieldErrors(data: ContactData): string[] {
  return (Object.keys(FIELDS) as Field[]).filter(k => (data[k] ?? "").length > 2000).map(k => `${FIELDS[k]}는 2,000자 이하여야 합니다.`);
}

/** All matches are recommendations; only the reviewer RPC can modify the Master. */
export function validateContact(input: ContactData, contacts: Contact[], organizations: Organization[], targetId: string | null = null, clear: Field[] = [], pending: ContactData[] = []): Validation {
  const explicit = contacts.find(c => c.id === targetId);
  const data = explicit ? mergeUpdate(visibleData(explicit), input, clear) : input;
  const errors = fieldErrors(data);
  const reasons: string[] = [];
  if (targetId && !explicit) errors.push("지정한 DB ID를 찾을 수 없습니다.");
  const exactOrgs = organizations.filter(o => [o.name, ...o.aliases].some(n => emailKey(n) === emailKey(data.company)));
  const similarOrgs = organizations.filter(o => [o.name, ...o.aliases].some(n => companyKey(n) === companyKey(data.company)));
  const orgs = exactOrgs.length ? exactOrgs : similarOrgs;
  const emailMatches = contacts.filter(c => data.email && emailKey(c.data.email) === emailKey(data.email));
  const nameMatches = contacts.filter(c => data.name && emailKey(c.data.name) === emailKey(data.name) && (orgs.some(o => o.id === c.organization_id) || companyKey(visibleData(c).company) === companyKey(data.company)));
  const candidates = [...new Set([...emailMatches, ...nameMatches, ...(explicit ? [explicit] : [])].map(c => c.id))];
  let kind: Validation["kind"] = "신규 등록";
  let target = explicit;
  if (emailMatches.length === 1) {
    target ??= emailMatches[0];
    reasons.push("기존 Master의 이메일과 일치합니다.");
    if (explicit && explicit.id !== emailMatches[0].id) errors.push("DB ID와 이메일이 서로 다른 Contact를 가리킵니다.");
  }
  if (target) kind = "기존 정보 업데이트";
  const identityConflict = target && (emailKey(target.data.name) !== emailKey(data.name) || !exactOrgs.some(o => o.id === target.organization_id));
  if (candidates.length > 1 || (!target && nameMatches.length) || identityConflict) {
    kind = "중복 의심";
    reasons.push("회사·성명 또는 이메일이 기존 Contact와 겹칩니다. 동일 인물 여부를 확인해 주세요.");
  }
  if (pending.some(p => (data.email && emailKey(p.email) === emailKey(data.email)) || (data.company && data.name && companyKey(p.company) === companyKey(data.company) && emailKey(p.name) === emailKey(data.name)))) {
    kind = "중복 의심"; reasons.push("검수 대기 또는 이번 제출 배치에도 같은 이메일/회사·성명이 있습니다.");
  }
  if (exactOrgs.length === 1) reasons.push(`기존 회사·기관: ${exactOrgs[0].name} / ${exactOrgs[0].category}`);
  else { reasons.push(orgs.length ? "유사 회사명 후보입니다. 동일 법인 여부를 확인해 주세요." : "신규 회사·기관입니다. 표준명과 분류를 확인해 주세요."); if (kind === "신규 등록") kind = "확인 필요"; }
  if (exactOrgs.length === 1 && exactOrgs[0].category === "확인 필요" && kind === "신규 등록") kind = "확인 필요";
  if (errors.length) kind = "확인 필요";
  return { kind, errors, reasons, candidates, organizationIds: orgs.map(o => o.id), targetId: target?.id ?? null, targetVersion: target?.version ?? null, ai: { status: "not_needed", reason: exactOrgs.length === 1 ? "기존 회사 기준 적용" : "회사 추천 대기" }, ruleVersion: "2026-09-14.1" };
}

export function validateAiResult(value: unknown, candidates: Organization[]) {
  if (!value || typeof value !== "object") throw new Error("AI 결과 형식 오류");
  const v = value as Record<string, unknown>;
  if (typeof v.reason !== "string" || !v.reason.trim() || v.reason.length > 1000 || !CATEGORIES.includes(v.category as typeof CATEGORIES[number])) throw new Error("AI 분류/근거 오류");
  if (v.organizationId !== null && (typeof v.organizationId !== "string" || !candidates.some(c => c.id === v.organizationId))) throw new Error("AI 후보 ID 오류");
  return { reason: v.reason, category: String(v.category), organizationId: v.organizationId as string | null };
}
