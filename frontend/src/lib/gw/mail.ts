import type { SupabaseClient } from "@supabase/supabase-js";
import { relayToolCall } from "@/lib/mcp/relay";

/** 웹 메일(아마란스) — 서버는 아마란스에 직접 닿지 않고, Claude 커넥터와 같은 `mcp_calls` 중계로 사용자의 데스크톱 앱에 도구 호출을 맡긴다(자격 증명은 기기에만). */
export type MailItem = { muid: string; subject: string; from: string; fromEmail: string; date: string; seen: boolean; attach: boolean };
export type MailAttachment = { fileName: string; fileSizeApprox: number };
export type MailDetail = { muid: string; subject: string; from: string; to: string; cc: string; date: string; body: string; attachments: MailAttachment[]; remoteResourceCount: number };
export type AppCall<T> = { ok: true; data: T } | { ok: false; code: "no_app" | "tool"; message: string };
/** 데스크톱 앱 색인 검색 결과 한 건(`search_mail_index`). `from`은 보낸 사람 이름 — 목록 항목과 같은 모양이라 본문 열기에 그대로 쓴다. */
export type MailHit = MailItem & { box: string; to: string; snippet: string };
export type MailSearch = { total: number; hits: MailHit[]; index: { docs: number; bodies: number; syncing: boolean; lastSync: string; error: string } };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "Y" || v === "y" || v === "true";
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
export const MUID_RE = /^\d{1,20}$/;

/** list_mail_inbox 원본 봉투(`Records`, `TotalUnseenCount`) → 목록. 키는 앱 MailItem.fromRow(mobile/lib/gw/gw_models.dart)와 같다. */
export function parseInbox(raw: unknown): { unread: number; items: MailItem[] } {
  const o = rec(raw);
  const items = (Array.isArray(o.Records) ? o.Records : []).map(rec).map((r) => ({
    muid: str(r.muid), subject: str(r.subject), from: str(r.fromAddrName), fromEmail: str(r.fromAddrEmail), date: str(r.rfc822date), seen: bool(r.seen), attach: bool(r.attach),
  })).filter((m) => MUID_RE.test(m.muid));
  return { unread: Math.max(0, Number(o.TotalUnseenCount ?? 0) || 0), items };
}

/** read_mail 결과(앱 mcp_tools `_readMail` 형식) → 본문 화면용. */
export function parseDetail(raw: unknown): MailDetail {
  const o = rec(raw);
  return {
    muid: str(o.muid), subject: str(o.subject), from: str(o.from), to: str(o.to), cc: str(o.cc), date: str(o.date), body: str(o.body),
    attachments: (Array.isArray(o.attachments) ? o.attachments : []).map(rec).map((a) => ({ fileName: str(a.fileName), fileSizeApprox: Number(a.fileSizeApprox ?? 0) || 0 })).filter((a) => a.fileName),
    remoteResourceCount: Number(o.remoteResourceCount ?? 0) || 0,
  };
}

/** search_mail_index 결과(앱 mcp_tools `_searchMail` 형식) → 검색 화면용. */
export function parseSearch(raw: unknown): MailSearch {
  const o = rec(raw), idx = rec(o.index);
  const num = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
  const hits = (Array.isArray(o.hits) ? o.hits : []).map(rec).map((h) => ({
    muid: str(h.muid), subject: str(h.subject), from: str(h.fromName), fromEmail: str(h.fromEmail), date: str(h.date), seen: bool(h.seen), attach: bool(h.attach), box: str(h.box), to: str(h.to), snippet: str(h.snippet),
  })).filter((h) => MUID_RE.test(h.muid));
  return { total: num(o.total ?? hits.length), hits, index: { docs: num(idx.docs), bodies: num(idx.bodies), syncing: bool(idx.syncing), lastSync: str(idx.lastSync), error: str(idx.error) } };
}

/** 데스크톱 앱 중계 호출 — 결과 텍스트(JSON)를 해석한다. 앱 미실행 안내는 code `no_app`. */
export async function callApp<T = unknown>(admin: SupabaseClient, userId: string, tool: string, args: Record<string, unknown>): Promise<AppCall<T>> {
  const r = await relayToolCall({ admin }, userId, tool, args);
  const text = r.content.map((c) => c.text).join("\n");
  if (r.isError) return { ok: false, code: text.includes("실행 중이 아닙니다") ? "no_app" : "tool", message: text };
  try { return { ok: true, data: JSON.parse(text) as T }; } catch { return { ok: false, code: "tool", message: "앱 응답을 해석하지 못했습니다." }; }
}

/** 받는 사람·참조 문자열 → 사람 목록. 따옴표·<주소> 안의 쉼표는 구분자가 아니다(앱 gw_models.dart splitRecipients와 같은 규칙). */
export function splitRecipients(s: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false, angle = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "<") angle = true;
    if (!quoted && ch === ">") angle = false;
    if (ch === "," && !quoted && !angle) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((r) => r.trim()).filter(Boolean);
}
