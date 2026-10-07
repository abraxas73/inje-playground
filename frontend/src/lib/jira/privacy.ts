import type { SupabaseClient } from "@supabase/supabase-js";
import { accessTokenFor, type JiraConnection } from "./client";
import { JiraError } from "./config";
const WEEK = 7 * 86400;
export function cycleSeconds(value: string | null) {
  if (value && /^\d+$/.test(value) && Number(value) > 0) return Number(value);
  const days = value?.match(/^P(\d+)D$/);
  return days && Number(days[1]) > 0 ? Number(days[1]) * 86400 : WEEK;
}
export async function reportAccounts(token: string, accounts: Array<{ accountId: string; updatedAt: string }>) {
  const res = await fetch("https://api.atlassian.com/app/report-accounts/", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ accounts }), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000) });
  if (res.status === 429) return { retry: Math.max(3600, Number(res.headers.get("Retry-After")) || 3600), cycle: WEEK, erase: [] as string[] };
  if (!res.ok) throw new JiraError("Jira 계정 정보 보고에 실패했습니다.");
  const result = res.status === 204 ? {} : await res.json();
  const requested = new Set(accounts.map(a => a.accountId));
  const erase = (Array.isArray(result.accounts) ? result.accounts : []).filter((a: {accountId?: string; status?: string}) => a.accountId && requested.has(a.accountId) && ["closed", "updated"].includes(a.status || "")).map((a: {accountId: string}) => a.accountId) as string[];
  return { retry: 0, cycle: cycleSeconds(res.headers.get("Cycle-Period")), erase };
}
export async function runPrivacyReport(admin: SupabaseClient) {
  const now = new Date();
  const { data: pending, error } = await admin.from("jira_connections").select("user_id").eq("auth_type", "oauth").lte("privacy_next_at", now.toISOString()).order("privacy_next_at").limit(90);
  if (error) throw new JiraError("Jira 보고 대상을 조회하지 못했습니다.",503);
  if (!pending?.length) return { reported: 0, erased: 0 };
  // 실행이 중복되어도 같은 계정을 동시에 보고하지 않도록 임대한다. 중단되면 다음 실행에서 재개.
  const { data, error: claimError } = await admin.from("jira_connections").update({ privacy_next_at: new Date(now.getTime() + 3600000).toISOString() }).in("user_id", pending.map(r => r.user_id)).lte("privacy_next_at", now.toISOString()).select("*");
  if (claimError) throw new JiraError("Jira 보고 대상을 준비하지 못했습니다.",503);
  const rows = (data || []) as (JiraConnection & {user_id: string})[];
  if (!rows.length) return { reported:0, erased:0 };
  let token: string | null = null;
  for (const row of rows) {
    try { token = await accessTokenFor(row, admin, row.user_id); break; }
    catch (e) { if (!(e instanceof JiraError) || e.code !== "reconnect") throw e; }
  }
  if (!token) return { reported:0, erased:rows.length };
  const result = await reportAccounts(token, rows.map(r => ({ accountId:r.account_id, updatedAt:r.connected_at })));
  let erased = 0;
  for (const row of rows) {
    const query = result.erase.includes(row.account_id)
      ? admin.from("jira_connections").delete()
      : admin.from("jira_connections").update({ privacy_next_at:new Date(Date.now() + (result.retry || result.cycle) * 1000).toISOString() });
    const { error: saveError } = await query.eq("user_id", row.user_id).eq("connected_at", row.connected_at);
    if (saveError) throw new JiraError("Jira 정보 보고 결과를 저장하지 못했습니다.",503);
    if (result.erase.includes(row.account_id)) erased++;
  }
  return { reported: result.retry ? 0 : rows.length, erased, ...(result.retry ? { retryAfter:result.retry } : {}) };
}
