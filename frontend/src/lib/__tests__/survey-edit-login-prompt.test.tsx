import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useParams: () => ({ id: "s1" }) }));
vi.mock("@/components/admin/surveys/SurveyBuilder", () => ({ default: () => null }));

import EditPage from "@/app/admin/surveys/[id]/edit/page";

afterEach(() => vi.unstubAllGlobals());

const base = { id: "s1", slug: "x", title: "설문", description: null, status: "draft", access_mode: "authenticated", is_anonymous: true, prompt_on_login: false, questions: [] };

it("'로그인 시 팝업' 스위치를 켜면 prompt_on_login을 PATCH하고 결과를 반영한다", async () => {
  const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
    init?.method === "PATCH"
      ? { ok: true, json: async () => ({ ...base, ...JSON.parse(String(init.body)) }) }
      : { ok: true, json: async () => base },
  );
  vi.stubGlobal("fetch", fetch);
  render(<EditPage />);
  const sw = await screen.findByRole("switch", { name: "로그인 시 팝업" });
  expect(sw).toHaveAttribute("aria-checked", "false");
  fireEvent.click(sw);
  await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
  const patch = fetch.mock.calls.find(([, i]) => i?.method === "PATCH");
  expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ prompt_on_login: true });
});

it("공개(익명 접근) 설문에서는 스위치를 끈 채 막는다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...base, access_mode: "public" }) })));
  render(<EditPage />);
  expect(await screen.findByRole("switch", { name: "로그인 시 팝업" })).toBeDisabled();
  expect(screen.getByText("로그인 필수 설문에서만 쓸 수 있습니다.")).toBeInTheDocument();
});
