import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CollapsibleCard } from "@/components/shared/CollapsibleCard";

describe("CollapsibleCard (모바일 기본 접힘)", () => {
  it("본문은 접힌 상태로 시작(모바일에서 숨김, md 이상은 항상 표시 — hidden md:block), 토글을 누르면 펼쳐진다", () => {
    render(<CollapsibleCard title="메일로 소식 받기"><p>본문입니다</p></CollapsibleCard>);
    const body = screen.getByText("본문입니다").parentElement!;
    expect(body.className).toContain("hidden");
    expect(body.className).toContain("md:block");
    const toggle = screen.getByRole("button", { name: /펼치기/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText("본문입니다").parentElement!.className).not.toContain("hidden");
    expect(screen.getByRole("button", { name: /접기/ }).getAttribute("aria-expanded")).toBe("true");
  });
});
