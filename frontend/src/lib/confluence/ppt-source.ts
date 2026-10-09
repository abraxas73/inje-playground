/** PPT 만들기 웹 주소 원고 — 회사 Confluence 페이지는 로그인 벽 때문에 HTML로 못 읽으므로 본인 Atlassian 권한으로 REST에서 읽는다. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { JiraError } from "@/lib/jira/config";
import { parseConfluencePageId, ConfluenceUrlError } from "@/lib/rfp/catalog/confluence";
import { clampSourceText } from "@/lib/ppt/web-source";
import { confluenceFor, readPage } from "./client";
import { CONFLUENCE_SITE } from "./core";

const HOST = new URL(CONFLUENCE_SITE).host;
export function isCompanyConfluenceUrl(url: string): boolean {
  try { return new URL(url.trim()).host.toLowerCase() === HOST; } catch { return false; }
}

/** 성공하면 원고 텍스트·제목, 실패하면 사용자에게 보여 줄 문구 */
export async function confluenceSource(admin: SupabaseClient, userId: string, url: string): Promise<{ ok: true; text: string; title: string } | { ok: false; error: string; status: number }> {
  try {
    const id = parseConfluencePageId(url, HOST);
    const c = await confluenceFor(admin, userId);
    const page = await readPage(c.request, id, 200_000);
    if (page.text.trim().length < 50) return { ok: false, error: "Confluence 페이지 본문이 비어 있거나 너무 짧습니다.", status: 400 };
    return { ok: true, text: clampSourceText(page.text), title: page.title };
  } catch (e) {
    if (e instanceof ConfluenceUrlError) return { ok: false, error: e.message, status: 400 };
    if (e instanceof JiraError) return { ok: false, error: `Confluence 페이지를 읽지 못했습니다: ${e.message}`, status: e.status === 409 || e.status === 503 ? 400 : e.status };
    return { ok: false, error: "Confluence 페이지를 읽지 못했습니다.", status: 502 };
  }
}
