import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import ManualPage from "@/app/manual/page";
import { manualSections, searchManual } from "@/lib/manual/sections";
import { PAGES } from "@/lib/page-access";

afterEach(cleanup);
it("covers every service in the navigation catalog, including the hidden guide", () => {
  const links = manualSections.flatMap((s) => s.links?.map((l) => l.href) ?? []);
  for (const p of PAGES) expect(links, p.label).toContain(p.href);
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
