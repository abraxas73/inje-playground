import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail, kstDay, dayList, upsertChunked, type CollectResult } from "./common";

/**
 * Confluence Cloud 일 집계 — 페이지 생성·수정 개수(본문 미수집).
 * Jira와 같은 ATLASSIAN_* 자격 사용. wiki API: {site}/wiki/rest/api
 */

interface CqlResult {
  results?: {
    content?: { space?: { key?: string } };
    space?: { key?: string };
    lastModified?: string;
    friendlyLastModified?: string;
    content_?: unknown;
    // content search shape
    history?: { createdDate?: string; createdBy?: { accountId?: string; email?: string; publicName?: string } };
    version?: { when?: string; by?: { accountId?: string; email?: string } };
    type?: string;
  }[];
  _links?: { next?: string };
}

function cfg() {
  const site = (process.env.ATLASSIAN_SITE ?? "").replace(/\/+$/, "");
  const email = process.env.ATLASSIAN_EMAIL ?? "";
  const token = process.env.ATLASSIAN_API_TOKEN ?? "";
  if (!site || !email || !token) return null;
  return { site, auth: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` };
}

async function cqlAll(cql: string): Promise<NonNullable<CqlResult["results"]>> {
  const c = cfg()!;
  const out: NonNullable<CqlResult["results"]> = [];
  let path = `/wiki/rest/api/content/search?cql=${encodeURIComponent(cql)}&expand=history,version,space&limit=100`;
  for (let page = 0; page < 30; page++) {
    const r = await fetch(`${c.site}${path}`, { headers: { Authorization: c.auth, Accept: "application/json" } });
    if (!r.ok) throw new Error(`Confluence search ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as CqlResult;
    out.push(...(j.results ?? []));
    if (!j._links?.next) break;
    path = j._links.next.startsWith("/wiki") ? j._links.next : `/wiki${j._links.next}`;
  }
  return out;
}

async function emailOf(admin: SupabaseClient, u: { accountId?: string; email?: string } | undefined, mapCache: Map<string, string>): Promise<string | null> {
  if (!u) return null;
  const direct = normalizeEmail(u.email);
  if (direct) return direct;
  if (u.accountId && mapCache.has(u.accountId)) return mapCache.get(u.accountId)!;
  return u.accountId ? `aid:${u.accountId}` : null;
}

export async function collectConfluence(admin: SupabaseClient, from: string, to: string): Promise<CollectResult> {
  if (!cfg()) return { source: "confluence", rows: 0, notes: "미설정(ATLASSIAN_*)" };
  const mapRes = await admin.from("atlassian_account_map").select("account_id, email").limit(3000);
  const mapCache = new Map<string, string>(((mapRes.data ?? []) as { account_id: string; email: string }[]).map((m) => [m.account_id, m.email]));

  const agg = new Map<string, { day: string; user_email: string; space_key: string; pages_created: number; pages_updated: number }>();
  const bump = (day: string, email: string, space: string) => {
    const k = `${day}|${email}|${space}`;
    let v = agg.get(k);
    if (!v) { v = { day, user_email: email, space_key: space, pages_created: 0, pages_updated: 0 }; agg.set(k, v); }
    return v;
  };

  const createdPages = await cqlAll(`type=page and created >= "${from}" and created <= "${to} 23:59"`);
  for (const p of createdPages) {
    const email = await emailOf(admin, p.history?.createdBy, mapCache);
    const when = p.history?.createdDate;
    if (!email || !when) continue;
    bump(kstDay(when), email, p.space?.key ?? "?").pages_created += 1;
  }

  const updatedPages = await cqlAll(`type=page and lastmodified >= "${from}" and lastmodified <= "${to} 23:59"`);
  for (const p of updatedPages) {
    const email = await emailOf(admin, p.version?.by, mapCache);
    const when = p.version?.when;
    if (!email || !when) continue;
    // 생성 직후 첫 수정은 생성과 같은 건이므로 생성일==수정일이면 제외
    if (p.history?.createdDate && kstDay(p.history.createdDate) === kstDay(when) && p.history.createdBy?.accountId === p.version?.by?.accountId) continue;
    bump(kstDay(when), email, p.space?.key ?? "?").pages_updated += 1;
  }

  const days = new Set(dayList(from, to));
  const rows = [...agg.values()].filter((r) => days.has(r.day));
  await upsertChunked(admin, "confluence_daily", rows, "day,user_email,space_key");
  return { source: "confluence", rows: rows.length, notes: `created ${createdPages.length}건, updated ${updatedPages.length}건` };
}
