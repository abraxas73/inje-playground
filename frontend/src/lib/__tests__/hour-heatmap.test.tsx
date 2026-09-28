import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HourHeatmap from "@/components/shared/HourHeatmap";

describe("HourHeatmap", () => {
  it("월~일 7행·24열을 그리고 최대값 셀에 숫자를 쓴다", () => {
    render(<HourHeatmap cells={[{ dow: 1, hour: 9, value: 10 }, { dow: 7, hour: 22, value: 4, title: "일 22시 — 커밋 4건" }]} unit="건" />);
    expect(screen.getByText("월")).toBeInTheDocument();
    expect(screen.getByText("일")).toBeInTheDocument();
    expect(screen.getByTitle("월 9시 — 10건")).toHaveTextContent("10"); // 최대값 셀에만 숫자
    expect(screen.getByTitle("일 22시 — 커밋 4건")).toBeInTheDocument();
    expect(screen.getByTitle("화 0시 — 없음")).toBeInTheDocument(); // 기본 title
  });
});
