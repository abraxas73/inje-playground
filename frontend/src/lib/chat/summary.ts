/** 도구 결과 → 사람이 읽는 한 줄(≤300자). DB에는 결과 원문 대신 이것만 남는다(설계서 §1.2). */
export const TOOL_LABEL: Record<string, string> = {
  list_mail_inbox: "받은메일 목록", mail_list: "받은메일 목록", read_mail: "메일 읽기", mail_read: "메일 읽기", search_mail_index: "메일 검색", mail_search: "메일 검색",
  pending_approvals: "미결 결재", approvals_pending: "미결 결재", read_approval: "결재 문서", approval_read: "결재 문서", approval_counts: "결재 건수", list_approvals: "결재 목록",
  list_notices: "게시판", notices_list: "게시판", read_notice: "게시글", notice_read: "게시글", search: "아마란스 통합검색",
  list_events: "일정", list_calendars: "캘린더", find_person: "사람 찾기", my_team: "우리 팀", org_chart: "조직도", get_attendance_today: "출퇴근", attendance_today: "출퇴근",
  my_reservations: "내 회의실 예약", list_resources: "회의실", list_rooms: "회의실", find_free_rooms: "빈 회의실",
  teams_chats: "Teams 채팅 목록", teams_mentions: "Teams 답장 대기", teams_send: "Teams 보내기",
  confluence_search: "Confluence 검색", confluence_read: "Confluence 문서", confluence_feed: "Confluence 소식", confluence_spaces: "Confluence 공간", confluence_create_page: "Confluence 페이지 만들기",
  sharepoint_search: "SharePoint 검색", sharepoint_recent: "SharePoint 문서", sharepoint_read: "SharePoint 문서 읽기",
};
export const toolLabel = (name: string) => TOOL_LABEL[name] ?? name;

const LIST_KEYS = ["items", "chats", "hits", "spaces", "events", "Records", "records", "results", "list", "people", "rooms"];
const TITLE_KEYS = ["subject", "title", "name", "topic", "docTitle", "artTitle"];
function findList(v: unknown): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of LIST_KEYS) if (Array.isArray(o[k])) return o[k] as unknown[];
  for (const x of Object.values(o)) if (Array.isArray(x)) return x;
  return null;
}
function titleOf(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  for (const k of TITLE_KEYS) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim().slice(0, 40);
  if (o.item && typeof o.item === "object") return titleOf(o.item);
  return "";
}

export function summarizeToolResult(tool: string, ok: boolean, result: unknown): string {
  const label = toolLabel(tool);
  if (!ok) return `${label} 실패: ${String(result).slice(0, 120)}`;
  const list = findList(result);
  if (list) {
    const titles = list.slice(0, 5).map(titleOf).filter(Boolean);
    return `${label} ${list.length}건${titles.length ? `: ${titles.join(", ")}` : ""}`.slice(0, 300);
  }
  const t = titleOf(result);
  return (t ? `${label}: ${t}` : `${label} 완료`).slice(0, 300);
}
