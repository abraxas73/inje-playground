import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ManualPage from "@/app/manual/page";
import { manualSections, searchManual } from "@/lib/manual/sections";
import { PAGES } from "@/lib/page-access";

afterEach(cleanup);
it("explains one-click desktop updates and the first manual-install migration", () => {
  const guide = manualSections.find(s => s.id === 'desktop-install')!;
  expect(guide.steps.join(' ')).toContain('자동으로 설치하고 재시작');
  expect(guide.steps.join(' ')).toContain('한 번 수동 설치');
  expect(guide.steps.join(' ')).toContain('About 이노크루');
});
it("covers every service in the navigation catalog (except the retired guide key)", () => {
  const links = manualSections.flatMap((s) => s.links?.map((l) => l.href) ?? []);
  // 앱 전용 아마란스 키(gw_*, 웹 주소 없음)는 앱 절이 다룬다 — 웹 링크 대상은 메일·결재·일정만
  for (const p of PAGES.filter((x) => x.key !== "guide" && (x.group !== "gw" || ["gw_mail", "gw_approvals", "gw_today"].includes(x.key)))) expect(links, p.label).toContain(p.href);
  expect(new Set(manualSections.map((s) => s.id)).size).toBe(manualSections.length);
});
it("finds instructions by step text and case-insensitive search", () => {
  expect(searchManual("sharepoint 폴더").map((s) => s.id)).toContain("settings");
  expect(searchManual("출근").map((s) => s.id)).toContain("amaranth");
});
it("filters the table of contents and sections together, and resets an empty result", () => {
  render(<ManualPage />);
  const search = screen.getByRole("searchbox", { name: "사용법 검색" });
  fireEvent.change(search, { target: { value: "존재하지않는검색어" } });
  expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "검색 초기화" }));
  expect(screen.getByRole("heading", { name: "앱 이노봇·음성 명령·확인 카드" })).toBeInTheDocument();
});
it("shows the Windows SmartScreen guide images with captions in the desktop install section", () => {
  render(<ManualPage />);
  expect(screen.getByAltText(/Windows의 PC 보호 창/)).toHaveAttribute("src", expect.stringContaining("windows-smartscreen-1"));
  expect(screen.getByText(/앱 이름이 INNOGRID 설치 파일인지 확인하고 ‘실행’을 누릅니다/)).toBeInTheDocument();
  expect(searchManual("SmartScreen").map((s) => s.id)).toContain("desktop-install");
});
it("Windows 브라우저 다운로드 경고 해제 방법을 강조색과 굵은 글씨로 표시한다", () => {
  render(<ManualPage />);
  const warning = screen.getByText("Edge는 다운로드 목록의 ‘…’ 메뉴 → 유지 → 그래도 유지, Chrome은 ‘유지’를 누릅니다.");
  expect(warning.tagName).toBe("STRONG");
  expect(warning).toHaveClass("font-bold", "text-amber-800");
});
it("앱 기능 절은 목차와 제목에 (모바일·데스크톱 앱) 표시가 붙고 앱 이름으로도 검색된다", () => {
  const tagged = manualSections.filter((s) => s.app);
  expect(tagged.map((s) => s.id)).toEqual(expect.arrayContaining(["app-approvals", "app-attendance", "app-today", "app-mail", "app-board", "desktop-mentions", "desktop-connector", "desktop-install"]));
  for (const s of tagged) expect(s.category).toBe(["desktop-install", "macos-update"].includes(s.id) ? "시작하기" : "모바일·데스크톱 앱");
  render(<ManualPage />);
  expect(screen.getAllByText("(모바일·데스크톱 앱)").length).toBeGreaterThanOrEqual(5);
  expect(screen.getAllByText("(데스크톱 앱)").length).toBeGreaterThanOrEqual(2);
  expect(screen.getAllByText("모바일·데스크톱 앱 · 데스크톱 앱").length).toBe(5); // 멘션 알림·Claude 커넥터·버튼 숨기기·위젯 대시보드·Always On
  expect(searchManual("데스크톱 앱").map((s) => s.id)).toContain("desktop-mentions");
  expect(searchManual("안 읽음으로 되돌리기").map((s) => s.id)).toEqual(expect.arrayContaining(["gw-mail"]));
});
it("앱 전용 기능 절(대시보드·Always On·알림 센터·메신저·테마·잠금 화면·즐겨찾기·버튼 숨기기)이 검색된다", () => {
  const ids = (q: string) => searchManual(q).map((s) => s.id);
  expect(ids("자동 배열")).toContain("desktop-dashboard");
  expect(ids("Always On")).toContain("desktop-pinned");
  expect(ids("모두 읽음")).toContain("app-notifications");
  expect(ids("쪽지")).toContain("app-messenger");
  expect(ids("다크")).toContain("app-theme");
  expect(ids("라이브 액티비티")).toContain("app-lock-briefing");
  expect(ids("☆")).toContain("app-favorites");
  expect(ids("버튼 숨기기")).toContain("app-fabs-hide");
  expect(manualSections.find((s) => s.id === "mobile-home")!.steps.join(" ")).toContain("위젯 대시보드");
});
