import { describe, expect, it } from "vitest";
import { weekRange, weeklyTitle, plainWeeklyDraft, type WeeklyData } from "@/lib/confluence/weekly";

describe("주간보고", () => {
  it("KST 기준 이번 주 월요일~오늘(일요일이면 그 주 월요일)", () => {
    expect(weekRange(new Date("2026-10-09T15:00:00Z"))).toEqual({ from: "2026-10-05", to: "2026-10-10" }); // KST 10-10(토) 00:00
    expect(weekRange(new Date("2026-10-11T03:00:00Z"))).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // 일
    expect(weekRange(new Date("2026-10-11T15:30:00Z"))).toEqual({ from: "2026-10-12", to: "2026-10-12" }); // KST 월 00:30
  });
  it("제목·기본 초안(Claude 없이) — 완료/진행 Jira, 이번 주 문서, 메모, 다음 주 계획 칸", () => {
    const d: WeeklyData = {
      range: { from: "2026-10-05", to: "2026-10-10" }, name: "홍길동",
      jira: [{ key: "A-1", summary: "배포", status: "완료", category: "done", url: "u1" }, { key: "A-2", summary: "설계", status: "진행 중", category: "indeterminate", url: "u2" }],
      pages: [{ title: "설계 문서", url: "p1", spaceName: "개발" }],
    };
    expect(weeklyTitle(d)).toBe("[주간보고] 2026-10-05 ~ 2026-10-10 홍길동");
    const md = plainWeeklyDraft(d, "고객 미팅 1건");
    expect(md).toContain("## 이번 주 한 일\n- A-1 배포 (완료)");
    expect(md).toContain("## 진행 중\n- A-2 설계 (진행 중)");
    expect(md).toContain("## 작성·수정한 문서\n- 설계 문서 (개발)");
    expect(md).toContain("## 메모\n고객 미팅 1건");
    expect(md).toContain("## 다음 주 계획\n- ");
  });
});
