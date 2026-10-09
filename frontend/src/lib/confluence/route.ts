import { requireUser } from "@/lib/rfp/require-user";
import { jiraFailure, jiraJson } from "@/lib/jira/route";
import { confluenceFor, type ConfluenceSession } from "./client";

type Auth = Extract<Awaited<ReturnType<typeof requireUser>>, { ok: true }>;
/** 로그인 확인 → 본인 Confluence 세션 → handler. 오류는 Jira와 같은 {error, code} 형식(code: not_connected·confluence_scope·reconnect·not_configured) */
export async function withConfluence(handler: (c: ConfluenceSession, auth: Auth) => Promise<unknown>) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    return jiraJson(await handler(await confluenceFor(auth.admin, auth.userId), auth));
  } catch (e) {
    return jiraFailure(e);
  }
}
