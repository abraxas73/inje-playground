/** 회의록·주간보고 표준 틀(마크다운). 이노봇 규칙 10의 회의록 구성과 같은 순서. */
export interface MeetingInfo { name?: string; date: string; time?: string; place?: string; attendees?: string }

export const meetingNotesTitle = (m: MeetingInfo) => `[회의록] ${m.date} ${m.name?.trim() || "회의"}`;

export function meetingNotesMarkdown(m: MeetingInfo): string {
  return [
    "## 회의 개요",
    `- 일시: ${m.date}${m.time?.trim() ? ` ${m.time.trim()}` : ""}`,
    `- 장소: ${m.place?.trim() ?? ""}`,
    `- 참석자: ${m.attendees?.trim() ?? ""}`,
    "",
    "## 안건",
    "- ",
    "",
    "## 논의 내용",
    "- ",
    "",
    "## 결정 사항",
    "- ",
    "",
    "## 액션 아이템",
    "| 할 일 | 담당 | 기한 |",
    "|---|---|---|",
    "|  |  |  |",
  ].join("\n");
}
