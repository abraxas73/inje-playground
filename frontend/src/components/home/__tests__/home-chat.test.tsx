import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
import HomeChatBox from "@/components/home/HomeChatBox";
beforeEach(() => { push.mockReset(); sessionStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ enabled: true, models: ["claude-sonnet-5-5"], defaultModel: "claude-sonnet-5-5" })))); });

it("홈에서 보내면 초안을 세션 저장소에 두고 /chat으로 — 주소에 질문이 없다", async () => {
  render(<HomeChatBox />);
  fireEvent.change(screen.getByRole("textbox", { name: "메시지" }), { target: { value: "오늘 일정" } });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "메시지" }), { key: "Enter" });
  expect(push).toHaveBeenCalledWith("/chat");
  expect(JSON.parse(sessionStorage.getItem("innobot:draft")!)).toMatchObject({ text: "오늘 일정", attachments: [] });
});
it("추천 질문 칩도 같은 길로", () => {
  render(<HomeChatBox />);
  fireEvent.click(screen.getByRole("button", { name: "오늘 일정 정리해 줘" }));
  expect(push).toHaveBeenCalledWith("/chat");
});
