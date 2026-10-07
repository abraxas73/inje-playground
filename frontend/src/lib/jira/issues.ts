import { JIRA_SITE, JiraError, type JiraClient } from "./client";
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[0-9]+$/;
export type JiraIssue = { key: string; summary: string; status: string; statusId: string; category: string; priority: string; project: string; dueDate: string | null; updated: string; url: string };
const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const str = (v: unknown) => typeof v === "string" ? v : "";
export function issueSummary(raw: unknown): JiraIssue {
  const x = obj(raw), f = obj(x.fields), status = obj(f.status), key = str(x.key);
  return { key, summary: str(f.summary), status: str(status.name), statusId: str(status.id), category: str(obj(status.statusCategory).key), priority: str(obj(f.priority).name), project: str(obj(f.project).name), dueDate: str(f.duedate) || null, updated: str(f.updated), url: `${JIRA_SITE}/browse/${encodeURIComponent(key)}` };
}
export function adfText(raw: unknown, depth = 0): string {
  if (depth > 16) return "";
  const n = obj(raw);
  if (n.type === "text") return str(n.text).slice(0, 24000);
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return str(obj(n.attrs).text);
  const content = Array.isArray(n.content) ? n.content.slice(0, 200).map(v => adfText(v, depth + 1)).join("") : "";
  return (content + (["paragraph", "heading", "listItem", "codeBlock"].includes(str(n.type)) ? "\n" : "")).slice(0, 24000);
}
export async function myIssues(client: JiraClient, scope: string, cursor?: string) {
  const condition = scope === "progress" ? ' AND statusCategory = "In Progress"' : scope === "done" ? ' AND statusCategory = Done' : scope === "open" ? ' AND statusCategory != Done' : "";
  const result = await client("/rest/api/3/search/jql", { method: "POST", body: JSON.stringify({ jql: `assignee = currentUser()${condition} ORDER BY updated DESC`, maxResults: 50, fields: ["summary", "status", "priority", "project", "duedate", "updated"], ...(cursor ? { nextPageToken: cursor } : {}) }) });
  return { items: (Array.isArray(result?.issues) ? result.issues : []).map(issueSummary), nextPageToken: typeof result?.nextPageToken === "string" && result?.isLast !== true ? result.nextPageToken : null };
}
export async function ownIssue(client: JiraClient, accountId: string, key: string) {
  if (!ISSUE_KEY.test(key) || key.length > 100) throw new JiraError("이슈 키가 올바르지 않습니다.", 400);
  const issue = await client(`/rest/api/3/issue/${key}?fields=summary,status,priority,project,duedate,updated,description,assignee`);
  if (issue?.fields?.assignee?.accountId !== accountId) throw new JiraError("현재 본인 담당 이슈만 확인하고 처리할 수 있습니다.", 403);
  return issue;
}
export async function transitionsFor(client: JiraClient, key: string) {
  const result = await client(`/rest/api/3/issue/${key}/transitions?expand=transitions.fields`);
  return (Array.isArray(result?.transitions) ? result.transitions : []).map((v: unknown) => {
    const t = obj(v);
    const required = Object.values(obj(t.fields)).filter(v => obj(v).required === true).map(v => str(obj(v).name));
    return { id: str(t.id), name: str(t.name), to: str(obj(t.to).name), required };
  }) as Array<{ id: string; name: string; to: string; required: string[] }>;
}
export async function issueDetail(client: JiraClient, accountId: string, key: string) {
  const raw = await ownIssue(client, accountId, key);
  const [transitions, comments] = await Promise.all([transitionsFor(client, key), client(`/rest/api/3/issue/${key}/comment?maxResults=50&orderBy=-created`)]);
  return { ...issueSummary(raw), description: adfText(raw.fields.description).trim(), transitions, comments: (Array.isArray(comments?.comments) ? comments.comments as unknown[] : []).map((v: unknown) => {
    const c = obj(v); return { id: str(c.id), author: str(obj(c.author).displayName), body: adfText(c.body).trim(), created: str(c.created) };
  }), commentsTotal: Number(comments?.total ?? 0) };
}
export async function updateIssue(client: JiraClient, accountId: string, key: string, input: Record<string, unknown>) {
  const issue = await ownIssue(client, accountId, key);
  if (input.action === "transition") {
    if (input.expectedStatus !== issue.fields.status.id) throw new JiraError("상태가 변경되었습니다. 새로고침 후 다시 선택하세요.", 409);
    const available = await transitionsFor(client, key);
    const transition = available.find(t => t.id === input.transitionId);
    if (!transition) throw new JiraError("현재 사용할 수 없는 상태 변경입니다. 새로고침해 주세요.", 409);
    if (transition.required.length) throw new JiraError("필수 입력 항목이 있는 상태 변경입니다. Jira에서 열어 처리하세요.", 400);
    await client(`/rest/api/3/issue/${key}/transitions`, { method: "POST", body: JSON.stringify({ transition: { id: transition.id } }) });
  } else if (input.action === "comment") {
    const text = str(input.text).trim();
    if (!text || text.length > 4000) throw new JiraError("댓글은 1~4,000자로 입력하세요.", 400);
    await client(`/rest/api/3/issue/${key}/comment`, { method: "POST", body: JSON.stringify({ body: { version: 1, type: "doc", content: text.split(/\r?\n/).map(line => ({ type: "paragraph", content: line ? [{ type: "text", text: line }] : [] })) } }) });
  } else throw new JiraError("지원하지 않는 작업입니다.", 400);
}
