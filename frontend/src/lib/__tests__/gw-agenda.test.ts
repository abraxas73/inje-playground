import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { approvalWebUrl, parseApprovals, parseEvents, scheduleDate } from "@/lib/gw/agenda";
import { pagesForPath, canOpenPage } from "@/lib/page-access";

const fixture = (name: string) => JSON.parse(readFileSync(resolve(process.cwd(), "..", "mobile", "test", "mcp", "fixtures", name), "utf8"));

describe("웹 결재·일정 파서", () => {
  it("pending_approvals 결과(앱 _pendingApprovals 모양)를 목록·아마란스 링크로 읽고 잘못된 id는 버린다", () => {
    const r = parseApprovals({ kind: "pendingApprovals", totalCount: 3, count: 3, items: [
      { docId: "140764", formId: "41", title: "외근신청", form: "외근신청서", drafter: "홍길동", dept: "AX팀", arrivedDt: "20261020153012", waitingDays: 3, status: "진행", unread: true, fileCount: 1 },
      { docId: "1", formId: "36", title: "", arrivedDt: "20261023", waitingDays: null },
      { docId: "x\"><script>", formId: "1" }, null,
    ] });
    expect(r.total).toBe(3);
    expect(r.items).toEqual([
      { docId: "140764", formId: "41", title: "외근신청", form: "외근신청서", drafter: "홍길동", dept: "AX팀", arrived: "2026-10-20 15:30", waitingDays: 3, status: "진행", unread: true, fileCount: 1, url: approvalWebUrl("140764", "41") },
      { docId: "1", formId: "36", title: "", form: "", drafter: "", dept: "", arrived: "2026-10-23", waitingDays: null, status: "", unread: false, fileCount: 0, url: approvalWebUrl("1", "36") },
    ]);
    expect(approvalWebUrl("140764", "41")).toBe("https://gw.innogrid.com/#/popup?docID=140764&formId=41&docAuth=0&MicroModuleCode=eap&callComp=UBAP002");
    expect(parseApprovals(null)).toEqual({ total: 0, items: [] });
  });
  it("list_events 캡처 픽스처를 시간순 일정으로 읽는다", () => {
    const events = parseEvents(fixture("captured/list_events-after-update.json").toolResult);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.start)).toEqual(["2026-10-12T12:00", "2026-10-12T17:00", "2026-10-12T23:00"]);
    expect(events[1]).toEqual({ schSeq: "96816", title: "x", start: "2026-10-12T17:00", end: "2026-10-12T19:00", allday: false, calendar: "이노그리드", mine: false, attendees: "김민철" });
    expect(parseEvents({ events: [{ start: "2026-10-12T09:00" }, { start: "2026-10-12T00:00", allday: true }] }).map((e) => e.allday)).toEqual([true, false]);
    expect(parseEvents(undefined)).toEqual([]);
  });
  it("조회 날짜는 오늘(KST) ±7일의 실제 날짜만", () => {
    const now = new Date("2026-10-22T16:00:00Z"); // KST 10-23 01:00
    expect(scheduleDate(null, now)).toBe("2026-10-23");
    expect(scheduleDate("2026-10-30", now)).toBe("2026-10-30");
    expect(scheduleDate("2026-10-16", now)).toBe("2026-10-16");
    expect(scheduleDate("2026-10-31", now)).toBeNull();
    expect(scheduleDate("2026-02-30", now)).toBeNull();
    expect(scheduleDate("20261023", now)).toBeNull();
  });
  it("페이지·API 경로를 gw_approvals·gw_today 키로 검사한다", () => {
    expect(pagesForPath("/gw/approvals")).toEqual(["gw_approvals"]);
    expect(pagesForPath("/api/gw/approvals")).toEqual(["gw_approvals"]);
    expect(pagesForPath("/gw/today")).toEqual(["gw_today"]);
    expect(pagesForPath("/api/gw/schedule")).toEqual(["gw_today"]);
    expect(canOpenPage("user", "/api/gw/schedule", { gw_today: false })).toBe(false);
    expect(canOpenPage("guest", "/gw/approvals")).toBe(false);
  });
});
