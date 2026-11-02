import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import AppTipsSettings from "@/components/settings/AppTipsSettings";
import { DEFAULT_SETTINGS, type useSettings } from "@/hooks/useSettings";
import { DEFAULT_APP_TIPS, parseAppTips } from "@/lib/app-tips";

const hook = (value: string, updateLocal = vi.fn()) => ({ settings: { ...DEFAULT_SETTINGS, app_tips: value }, updateLocal } as unknown as ReturnType<typeof useSettings>);

it("빈 값·깨진 값은 기본 목록(30개 이상), 글은 다듬고 빈 글은 빼고 가중치는 0~10 정수", () => {
  expect(DEFAULT_APP_TIPS.length).toBeGreaterThanOrEqual(30);
  expect(parseAppTips("")).toBe(DEFAULT_APP_TIPS);
  expect(parseAppTips("{")).toBe(DEFAULT_APP_TIPS);
  expect(parseAppTips(JSON.stringify([{ text: " 가 ", weight: 2.6 }, { text: "  ", weight: 1 }, { text: "나", weight: 99 }, { text: "다", weight: -1 }, { text: "라" }])))
    .toEqual([{ text: "가", weight: 3 }, { text: "나", weight: 10 }, { text: "다", weight: 0 }, { text: "라", weight: 1 }]);
  expect(parseAppTips(JSON.stringify([{ text: "가 ", weight: 1 }, { text: "", weight: 1 }]), true)).toEqual([{ text: "가 ", weight: 1 }, { text: "", weight: 1 }]);
});

it("관리자 화면: 가중치를 바꾸면 비율이 보이고, 추가·삭제가 저장 후보에 들어간다", () => {
  const updateLocal = vi.fn();
  render(<AppTipsSettings settingsHook={hook(JSON.stringify([{ text: "가", weight: 3 }, { text: "나", weight: 1 }, { text: "다", weight: 0 }]), updateLocal)} />);
  expect(screen.getByText("75%")).toBeInTheDocument();
  expect(screen.getByText("숨김")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("팁 2 가중치"), { target: { value: "5" } });
  expect(JSON.parse(updateLocal.mock.calls.at(-1)![1])[1]).toEqual({ text: "나", weight: 5 });
  fireEvent.click(screen.getByLabelText("팁 1 삭제"));
  expect(JSON.parse(updateLocal.mock.calls.at(-1)![1]).map((t: { text: string }) => t.text)).toEqual(["나", "다"]);
  fireEvent.click(screen.getByText("팁 추가"));
  expect(JSON.parse(updateLocal.mock.calls.at(-1)![1])).toHaveLength(4);
});
