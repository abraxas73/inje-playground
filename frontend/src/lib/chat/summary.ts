/** 도구 결과 → 사람이 읽는 한 줄(≤300자). DB에는 결과 원문 대신 이것만 남는다(설계서 §1.2). */
export const TOOL_LABEL: Record<string, string> = {
  list_mail_inbox: "받은메일 목록", mail_list: "받은메일 목록", read_mail: "메일 읽기", mail_read: "메일 읽기", search_mail_index: "메일 검색", mail_search: "메일 검색",
  pending_approvals: "미결 결재", approvals_pending: "미결 결재", read_approval: "결재 문서", approval_read: "결재 문서", approval_counts: "결재 건수", list_approvals: "결재 목록",
  mailbox_counts: "메일함 건수", list_notices: "게시판", notices_list: "게시판", read_notice: "게시글", notice_read: "게시글", search: "아마란스 통합검색",
  list_events: "일정", list_calendars: "캘린더", find_person: "사람 찾기", my_team: "우리 팀", org_chart: "조직도", get_attendance_today: "출퇴근", attendance_today: "출퇴근",
  my_reservations: "내 회의실 예약", list_resources: "회의실", list_rooms: "회의실", find_free_rooms: "빈 회의실",
  teams_chats: "Teams 채팅 목록", teams_mentions: "Teams 답장 대기", teams_send: "Teams 보내기",
  confluence_search: "Confluence 검색", confluence_read: "Confluence 문서", confluence_feed: "Confluence 소식", confluence_spaces: "Confluence 공간", confluence_create_page: "Confluence 페이지 만들기",
  list_messenger_rooms: "메신저 대화방", messenger_rooms: "메신저 대화방", read_messenger_room: "메신저 대화", messenger_read: "메신저 대화", search_messenger: "메신저 검색", messenger_search: "메신저 검색", messenger_send: "메신저 보내기",
  sharepoint_search: "SharePoint 검색", sharepoint_recent: "SharePoint 문서", sharepoint_read: "SharePoint 문서 읽기",
  jira_issues: "Jira 내 업무", jira_issue: "Jira 이슈", people_news: "인사·부고", food_search: "식당 찾기", ppt_decks: "내 PPT", ppt_create: "PPT 만들기",
  todo_list: "할 일 목록", todo_add: "할 일 추가", todo_update: "할 일 바꾸기", open_screen: "화면 열기", team_absences: "팀원 부재",
  whoami: "내 정보", attendance_month: "월 근태", person_group: "사람 묶음", save_person_group: "사람 묶음 저장", delete_person_group: "사람 묶음 삭제",
  list_mailboxes: "메일함", list_mail_drafts: "임시보관함", download_mail_attachment: "메일 첨부 내려받기", mark_mail_unread: "안 읽음 표시", delete_mail: "메일 삭제", send_mail_from_draft: "임시보관 메일 발송",
  update_calendar_event: "일정 수정", list_reservations: "회의실 예약 현황", update_reservation: "예약 수정", list_notice_attachments: "게시글 첨부", download_notice_attachment: "게시글 첨부 내려받기",
  list_approval_attachments: "결재 첨부", download_approval_attachment: "결재 첨부 내려받기", list_approval_lines: "결재선", read_approval_line: "결재선 보기", list_approval_line_schemas: "결재선 양식", get_approval_line_schema: "결재선 양식 보기",
  suggest_approval_line: "결재선 추천", save_approval_line: "결재선 저장", delete_approval_line: "결재선 삭제", list_approval_submission_guides: "상신 안내 목록", get_approval_submission_guide: "상신 안내",
  submit_approval: "결재 상신", cancel_approval: "결재 회수", delete_temp_approval: "임시 결재 삭제",
};
export const toolLabel = (name: string) => TOOL_LABEL[name] ?? name;

const LIST_KEYS = ["items", "chats", "hits", "spaces", "events", "Records", "records", "results", "list", "people", "rooms", "messages"];
const TITLE_KEYS = ["subject", "title", "name", "topic", "docTitle", "artTitle"];
function findList(v: unknown, anyArray = false): unknown[] | null {
  if (Array.isArray(v)) return v;
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  for (const k of LIST_KEYS) if (Array.isArray(o[k])) return o[k] as unknown[];
  if (anyArray) for (const x of Object.values(o)) if (Array.isArray(x)) return x;
  return null;
}
function reasonOf(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const k of ["message", "error"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return JSON.stringify(r) ?? String(r);
}
const listLine = (label: string, list: unknown[]) => {
  const titles = list.slice(0, 5).map(titleOf).filter(Boolean);
  return `${label} ${list.length}건${titles.length ? `: ${titles.join(", ")}` : ""}`.slice(0, 300);
};
function titleOf(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const o = v as Record<string, unknown>;
  for (const k of TITLE_KEYS) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim().slice(0, 40);
  if (o.item && typeof o.item === "object") return titleOf(o.item);
  return "";
}

export function summarizeToolResult(tool: string, ok: boolean, result: unknown): string {
  const label = toolLabel(tool);
  if (!ok) return `${label} 실패: ${reasonOf(result).slice(0, 120)}`;
  const list = findList(result);
  if (list) return listLine(label, list);
  const t = titleOf(result);
  if (t) return `${label}: ${t}`.slice(0, 300);
  const any = findList(result, true);
  return any ? listLine(label, any) : `${label} 완료`;
}
