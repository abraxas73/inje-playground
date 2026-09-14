export const CATEGORIES = ["IT기업", "솔루션·제품사", "공공기관", "확인 필요", "기타", "교육·연구", "제조사", "금융", "협회·단체", "언론"] as const;
export const KINDS = ["신규 등록", "기존 정보 업데이트", "중복 의심", "확인 필요"] as const;
export const FIELDS = { company: "회사명", name: "성명", department: "소속부서", position: "직책", email: "이메일", phone: "연락처", source: "원본출처", sourceSheet: "원본시트", ownerDepartment: "내부 관리부서(기존)", eco: "Eco 여부", ecoId: "Eco ID", ecoType: "Eco 구분", ecoMiddle: "Eco 중분류", ecoSmall: "Eco 소분류", confirmedAt: "최종확인일", notes: "비고" } as const;
export type Field = keyof typeof FIELDS;
export const MASTER_SORT_FIELDS = { category: "분류", db_id: "DB ID", ...FIELDS } as const;
export type MasterSortField = keyof typeof MASTER_SORT_FIELDS;
export type SortDirection = "asc" | "desc";
export const MASTER_HEADER_GROUPS = [
  { label: "회사·기관 분류", span: 1 }, { label: "기본정보", span: 7 },
  { label: "원본정보", span: 3 }, { label: "Eco Partner 연계", span: 5 }, { label: "관리정보", span: 2 },
] as const;
export type ContactData = Record<Field, string>;
export const emptyContact = (): ContactData => Object.fromEntries(Object.keys(FIELDS).map(k => [k, ""])) as ContactData;
export interface Organization { id: string; name: string; category: string; aliases: string[]; version: number; review_status?: "pending" | "confirmed" }
export interface Contact { id: string; db_id: string; organization_id: string | null; version: number; data: ContactData; organization?: Organization | null; needs_maintenance?: boolean }
export interface Validation {
  ruleCheck?: import("./rules").RuleCheck;
  kind: typeof KINDS[number]; reasons: string[]; errors: string[]; candidates: string[];
  organizationIds: string[]; targetId: string | null; targetVersion: number | null;
  ai: { status: "not_needed" | "unavailable" | "success" | "failed"; reason: string; category?: string; organizationId?: string | null; model?: string };
  ruleVersion: string;
}
export interface Submission { id: string; data: ContactData; target_id: string | null; clear_fields: Field[]; validation: Validation; status: "validating" | "pending" | "approved" | "rejected" | "unchanged"; version: number; created_at: string; submitted_by: string; submitter: string; division: string; source: Record<string, unknown>; result_contact_id: string | null }
export interface ReviewEvent { id: string; action: string; actor_name: string; created_at: string; reason: string; before_data: unknown; after_data: unknown; submission_id: string | null; contact_id?: string | null; organization_id?: string | null; submitter?: string | null; division?: string | null; source?: unknown; validation_snapshot?: unknown }
export const visibleData = (c: Contact): ContactData => ({ ...emptyContact(), ...c.data, company: c.organization?.name ?? c.data.company });
export const emailKey = (v: string) => v.trim().toLowerCase();
export const companyKey = (v: string) => v.trim().toLowerCase().replace(/주식회사|\(주\)|㈜|\s/g, "");

export interface SubmissionResult { index: number; row: number; status: "submitted" | "error"; id?: string; requestKey?: string; error?: string; kind?: Validation["kind"]; validationErrors?: string[] }
export interface ValidationRecord { id: string; submission_version: number; result: Validation; created_at: string; origin: string }
export interface ReviewCheck { ruleCheck?: import("./rules").RuleCheck; blockingErrors?: string[]; token: string; checkedAt: string; conflicts: { key: string; message: string; version?: number }[] }
export interface OrganizationConflict { key: string; unresolved: boolean; organizations: { id: string; name: string; category: string; review_status: string }[] }
