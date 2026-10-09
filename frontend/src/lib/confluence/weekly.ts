/**
 * 주간보고 초안 — 이번 주(KST 월요일~오늘) 내 Jira 업무(담당·이번 주 갱신)와 내가 작성·수정한 Confluence 문서를 모아
 * Claude가 마크다운 초안을 쓴다. 키가 없거나 실패하면 모은 내용으로 틀만 채운다(사용자가 고쳐서 올린다).
 * Claude에는 제목·상태·문서 이름만 보낸다(본문 없음). 결과·입력은 저장·로그하지 않는다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { issueSummary } from "@/lib/jira/issues";
import type { JiraClient } from "@/lib/jira/client";
import { cqlSearch, type ConfluenceFetch } from "./client";

export interface WeeklyData {
  range: { from: string; to: string };
  name: string;
  jira: Array<{ key: string; summary: string; status: string; category: string; url: string }>;
  pages: Array<{ title: string; url: string; spaceName: string }>;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** KST 기준 이번 주 월요일 ~ 오늘 */
export function weekRange(now: Date = new Date()): { from: string; to: string } {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const back = (k.getUTCDay() + 6) % 7; // 월=0 … 일=6
  return { from: ymd(new Date(k.getTime() - back * 86400_000)), to: ymd(k) };
}
export const weeklyTitle = (d: WeeklyData) => `[주간보고] ${d.range.from} ~ ${d.range.to}${d.name ? ` ${d.name}` : ""}`;

export async function collectWeekly(o: { jira: JiraClient | null; confluence: ConfluenceFetch; name: string; now?: Date }): Promise<WeeklyData> {
  const range = weekRange(o.now);
  const [jira, pages] = await Promise.all([
    o.jira
      ? o.jira("/rest/api/3/search/jql", { method: "POST", body: JSON.stringify({ jql: `assignee = currentUser() AND updated >= "${range.from}" ORDER BY updated DESC`, maxResults: 30, fields: ["summary", "status", "priority", "project", "duedate", "updated"] }) })
          .then((r) => (Array.isArray((r as { issues?: unknown })?.issues) ? ((r as { issues: unknown[] }).issues).map(issueSummary) : []))
          .catch(() => [])
      : Promise.resolve([]),
    cqlSearch(o.confluence, `type in (page, blogpost) and contributor = currentUser() and lastmodified >= "${range.from}" order by lastmodified desc`, 20),
  ]);
  return {
    range, name: o.name,
    jira: jira.map((i) => ({ key: i.key, summary: i.summary, status: i.status, category: i.category, url: i.url })),
    pages: pages.map((p) => ({ title: p.title, url: p.url, spaceName: p.spaceName })),
  };
}

/** Claude 없이 모은 내용으로 채운 틀 */
export function plainWeeklyDraft(d: WeeklyData, memo = ""): string {
  const done = d.jira.filter((i) => i.category === "done");
  const doing = d.jira.filter((i) => i.category !== "done");
  const line = (i: WeeklyData["jira"][number]) => `- ${i.key} ${i.summary} (${i.status})`;
  return [
    "## 이번 주 한 일", ...(done.length ? done.map(line) : ["- "]), "",
    "## 진행 중", ...(doing.length ? doing.map(line) : ["- "]), "",
    "## 작성·수정한 문서", ...(d.pages.length ? d.pages.map((p) => `- ${p.title}${p.spaceName ? ` (${p.spaceName})` : ""}`) : ["- "]), "",
    ...(memo.trim() ? ["## 메모", memo.trim(), ""] : []),
    "## 다음 주 계획", "- ", "",
    "## 이슈·요청 사항", "- ",
  ].join("\n");
}

const SYSTEM = [
  "너는 이노그리드 구성원의 주간보고 초안을 쓰는 비서다. 입력 JSON(이번 주 Jira 업무·작성한 Confluence 문서·메모)만 근거로 한국어 마크다운을 쓴다.",
  "형식: '## 이번 주 한 일' / '## 진행 중' / '## 작성·수정한 문서' / '## 다음 주 계획' / '## 이슈·요청 사항' 순서, 각 항목은 '- '로 시작하는 한 줄.",
  "Jira 항목은 이슈 키를 앞에 둔다(예: '- PRJ-12 배포 자동화 완료'). 같은 일을 묶어 짧게 다듬되, 입력에 없는 성과·수치·계획을 지어내지 않는다.",
  "다음 주 계획은 진행 중 업무에서 자연스럽게 이어지는 것만 쓰고, 근거가 없으면 '- '로 비워 둔다. 메모가 있으면 알맞은 절에 반영한다.",
  "마크다운 본문만 출력한다(앞뒤 설명·코드 블록 금지).",
].join("\n");

export async function llmWeeklyDraft(d: WeeklyData, memo: string, deps: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Promise<string> {
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const input = { 기간: d.range, jira: d.jira.map(({ key, summary, status, category }) => ({ key, summary, status, done: category === "done" })), 문서: d.pages.map((p) => ({ 제목: p.title, 공간: p.spaceName })), 메모: memo.slice(0, 2000) };
  const msg = await client.messages.create({
    model: deps.model ?? (process.env.CONFLUENCE_WEEKLY_MODEL || "claude-sonnet-5-5"), max_tokens: 2000, system: SYSTEM,
    messages: [{ role: "user", content: JSON.stringify(input) }],
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim().replace(/^```(?:markdown)?\n?|\n?```$/g, "");
  if (msg.stop_reason === "max_tokens" || !text) throw new Error("주간보고 초안이 비었거나 잘렸습니다");
  return text;
}
