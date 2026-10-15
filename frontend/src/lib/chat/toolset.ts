import type Anthropic from "@anthropic-ai/sdk";
import mcpTools from "@/lib/mcp/tools.json";
import { ASSISTANT_TOOLS, SERVER_TOOLS, TOOL_TIERS, type ToolTier } from "@/lib/assistant/tools";
import type { PageKey } from "@/lib/page-access";
import type { Location } from "./events";

/** 웹에서 데스크톱 앱 중계로 여는 아마란스 도구 — 읽기만(설계서 §0 "웹의 아마란스"). 이름·스키마는 Claude 커넥터(tools.json)와 같다. */
export const RELAY_READ_TOOLS = ["find_person", "org_chart", "list_mail_inbox", "read_mail", "search_mail_index", "mailbox_counts", "pending_approvals", "approval_counts", "list_approvals", "read_approval", "list_notices", "read_notice", "search", "list_calendars", "list_events", "get_attendance_today", "my_reservations", "list_resources", "find_free_rooms"] as const;
/** 결과의 전화번호를 가리지 않는 사내 조직도 도구(설계서 §2-4 예외) */
export const ORG_TOOLS = new Set(["find_person", "my_team", "org_chart"]);

// 앱 1.6.9+의 기기 안 메일 색인 검색 — tools.json(커넥터 노출 목록) 밖이라 스키마를 여기 둔다.
const SEARCH_MAIL_INDEX: Anthropic.Tool = {
  name: "search_mail_index",
  description: "메일 찾기 — 데스크톱 앱이 기기 안에 만든 색인(받은·보낸 메일함의 제목·보낸 사람·받는 사람·첨부 이름, 읽은 메일 본문)을 검색식으로 찾는다. 단어 여러 개는 AND, 'a OR b', \"구문\", -제외, from: to: subject: body: file: after:YYYY-MM-DD before:YYYY-MM-DD has:attach is:unread in:sent. 결과에 본문 발췌·muid.",
  input_schema: { type: "object", properties: { query: { type: "string", description: "검색식" }, by_relevance: { type: "boolean", description: "관련도순(기본 최신순)" }, limit: { type: "integer", description: "최대 50, 기본 20" } }, required: ["query"] },
};
const RELAY_TOOLS: Anthropic.Tool[] = [
  ...(mcpTools as Array<{ name: string; description: string; inputSchema: Anthropic.Tool.InputSchema }>)
    .filter((t) => (RELAY_READ_TOOLS as readonly string[]).includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  SEARCH_MAIL_INDEX,
];

const pageOf = (name: string): PageKey | null => (name.startsWith("teams_") ? "teams_chat" : name.startsWith("confluence_") ? "confluence" : name.startsWith("sharepoint_") ? "sharepoint" : null);

export function buildToolset(o: { client: "web" | "app"; desktopOnline: boolean; allowed: (k: PageKey) => boolean }): { tools: Anthropic.Tool[]; location: Record<string, Location> } {
  const tools: Anthropic.Tool[] = [];
  const location: Record<string, Location> = {};
  for (const t of ASSISTANT_TOOLS) {
    if ((SERVER_TOOLS as readonly string[]).includes(t.name)) {
      const key = pageOf(t.name);
      if (key && !o.allowed(key)) continue;
      tools.push(t); location[t.name] = "server";
    } else if (o.client === "app") {
      tools.push(t); location[t.name] = "device";
    }
  }
  // 아마란스 중계는 Claude 커넥터와 같은 통로라 같은 페이지 키(mcp)로 묶는다.
  if (o.client === "web" && o.desktopOnline && o.allowed("mcp")) for (const t of RELAY_TOOLS) { tools.push(t); location[t.name] = "desktop-relay"; }
  return { tools, location };
}

export function tierOf(name: string): ToolTier {
  return TOOL_TIERS[name] ?? ((RELAY_READ_TOOLS as readonly string[]).includes(name) ? "read" : "write");
}
/** 사람(확인 카드)이나 앱이 처리해야 하는 호출인가. 모르는 도구(location null)는 서버가 오류로 바로 답한다. */
export function needsAction(c: { location: Location | null; tier: string }): boolean {
  if (!c.location) return false;
  return c.location === "device" || c.tier !== "read";
}

/** 클라이언트별 추가 지침 — 고정 규칙(캐시) 뒤 두 번째 블록에 붙는다. */
export function clientPromptLines(client: "web" | "app", desktopOnline: boolean): string[] {
  if (client === "app") return [];
  return [
    "지금은 웹 채팅이다. 답에 마크다운(목록·표·굵게)을 써도 된다. 쓰기 도구는 웹 화면이 확인 카드를 띄운다.",
    "웹에서 아마란스는 조회만 된다. 회의실 예약·일정 등록·출퇴근·메일 저장·발송·결재 같은 아마란스 쓰기는 모바일·데스크톱 앱의 이노봇에서 하라고 안내한다.",
    desktopOnline
      ? "아마란스 도구 이름은 list_mail_inbox·read_mail·search_mail_index·pending_approvals 등이다."
      : "데스크톱 앱이 꺼져 있어 아마란스 도구가 없다. 메일·결재·일정 같은 아마란스 요청이면 INNOGRID 데스크톱 앱을 켜면 처리할 수 있다고 안내한다.",
  ];
}
