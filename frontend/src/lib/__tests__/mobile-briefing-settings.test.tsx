import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MobileBriefingSettings from "@/components/settings/MobileBriefingSettings";
import { DEFAULT_SETTINGS, type useSettings } from "@/hooks/useSettings";

const hook = (value: string, updateLocal = vi.fn()) => ({ settings: { ...DEFAULT_SETTINGS, mobile_briefing_llm: value }, updateLocal } as unknown as ReturnType<typeof useSettings>);

it("빈 값·on은 켜짐으로 보이고, 끄면 off를 저장 후보에 넣는다", () => {
  const updateLocal = vi.fn();
  render(<MobileBriefingSettings settingsHook={hook("", updateLocal)} />);
  const sw = screen.getByRole("switch", { name: /Claude가 '오늘의 한 마디'를 씁니다/ });
  expect(sw).toHaveAttribute("aria-checked", "true");
  fireEvent.click(sw);
  expect(updateLocal).toHaveBeenCalledWith("mobile_briefing_llm", "off");
});
it("off면 꺼짐으로 보이고 켜면 on", () => {
  const updateLocal = vi.fn();
  render(<MobileBriefingSettings settingsHook={hook("off", updateLocal)} />);
  const sw = screen.getByRole("switch");
  expect(sw).toHaveAttribute("aria-checked", "false");
  fireEvent.click(sw);
  expect(updateLocal).toHaveBeenCalledWith("mobile_briefing_llm", "on");
  expect(screen.getByText(/격언/)).toBeInTheDocument();
});
