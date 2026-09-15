export const CHECK_LABELS = { pass: "근거 확인", review: "확인 필요", fail: "문제 발견", error: "실행 오류", skipped: "검사 제외" } as const;
export type CheckState = keyof typeof CHECK_LABELS;
export interface Evidence { state: CheckState; code: string; message: string }
export interface MailProbe extends Evidence { checkedAt: string; domain: string; mx?: { exchange: string; priority: number }[] }
export interface WebProbe extends Evidence { checkedAt: string; url: string; finalUrl?: string; status?: number; title?: string; text?: string; redirects?: string[] }
export interface EmailProfile { organization_id: string; version: number; website: string; domains: string[]; reason: string; actor_name: string; updated_at: string }
export interface EmailSnapshot { id: string; db_id: string; version: number; organization_id: string | null; company: string; name: string; email: string; organization_version: number | null; profile: EmailProfile | null }
export interface EmailResult { engine: string; checkedAt: string; email: string; domain: string; state: CheckState; syntax: Evidence; relationship: Evidence; mail: MailProbe; website: WebProbe; mailbox: Evidence; companyMentioned: boolean; websiteSource: "approved" | "candidate" | "none" }
export interface EmailRun { id: string; scope: "all" | "filtered" | "selected"; filters: Record<string, unknown>; actor_name: string; status: "queued" | "running" | "completed" | "cancelled"; total: number; processed: number; created_at: string; finished_at: string | null }
export interface EmailRow { contact_id: string; snapshot: EmailSnapshot; result: EmailResult | null; stale: boolean; profile: EmailProfile | null }
export interface EmailReport { run: EmailRun; rows: EmailRow[]; total: number; counts: Record<string, number>; token: string }
export type EmailAttemptResult = Partial<EmailResult> & { state: CheckState; message?: string };
export interface ContactEmailEvent {
 id: string; email_result_id: string; created_at: string; actor_name: string;
 after_data: { contact: EmailSnapshot }; source: { runId: string; resultId: string };
 validation_snapshot: EmailAttemptResult; stale?: boolean;
}
export interface ContactEmailHistory { rows: ContactEmailEvent[]; total: number; pageSize: number }
