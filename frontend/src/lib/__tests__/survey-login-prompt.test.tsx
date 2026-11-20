import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname, useRouter: () => ({ push: nav.push }) }));

import SurveyLoginPrompt from "@/components/layout/SurveyLoginPrompt";

const SURVEY = { slug: "ai-companion-efficiency", title: "AI 컴패니언 툴 도입 3개월 업무 효율성 점검" };
const fetchWith = (status: number, body: unknown) => vi.fn(async () => ({ ok: status < 400, json: async () => body }));

beforeEach(() => {
  nav.pathname = "/";
  nav.push.mockReset();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

it("미참여 설문이 있으면 팝업 — [참여하기]는 설문으로 이동", async () => {
  vi.stubGlobal("fetch", fetchWith(200, { survey: SURVEY }));
  render(<SurveyLoginPrompt />);
  expect(await screen.findByText(SURVEY.title)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "참여하기" }));
  expect(nav.push).toHaveBeenCalledWith("/survey/ai-companion-efficiency");
});

it("[나중에]를 누르면 같은 브라우저 세션에서는 다시 띄우지 않는다", async () => {
  vi.stubGlobal("fetch", fetchWith(200, { survey: SURVEY }));
  const first = render(<SurveyLoginPrompt />);
  fireEvent.click(await screen.findByRole("button", { name: "나중에" }));
  expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument();
  first.unmount();
  render(<SurveyLoginPrompt />);
  await act(async () => {});
  expect(screen.queryByText(SURVEY.title)).not.toBeInTheDocument();
});

it("참여했거나(없음)·로그인 전(401)·설문·로그인 화면에서는 띄우지 않는다", async () => {
  vi.stubGlobal("fetch", fetchWith(200, { survey: null }));
  const a = render(<SurveyLoginPrompt />);
  await act(async () => {});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  a.unmount();
  vi.stubGlobal("fetch", fetchWith(401, { survey: null }));
  const b = render(<SurveyLoginPrompt />);
  await act(async () => {});
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  b.unmount();
  const f = fetchWith(200, { survey: SURVEY });
  vi.stubGlobal("fetch", f);
  for (const p of ["/survey/ai-companion-efficiency", "/login"]) {
    nav.pathname = p;
    const c = render(<SurveyLoginPrompt />);
    await act(async () => {});
    c.unmount();
  }
  expect(f).not.toHaveBeenCalled();
});
