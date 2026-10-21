import { describe, it, expect } from "vitest";
import { parseDashboard } from "@/lib/home-dashboard";

describe("parseDashboard", () => {
  it("유효한 타일만 통과시킨다", () => {
    const tiles = parseDashboard(JSON.stringify([
      { id: "briefing", x: 0, y: 0, w: 8, h: 4 },
      { id: "quote", x: 8, y: 0, w: 4, h: 2 },
    ]));
    expect(tiles).toEqual([
      { id: "briefing", x: 0, y: 0, w: 8, h: 4 },
      { id: "quote", x: 8, y: 0, w: 4, h: 2 },
    ]);
  });

  it("모르는 id·범위 밖·x+w>12·중복은 버린다", () => {
    const tiles = parseDashboard(JSON.stringify([
      { id: "unknown", x: 0, y: 0, w: 4, h: 2 }, // 모르는 위젯
      { id: "mails", x: 10, y: 0, w: 4, h: 2 },  // x+w=14 > 12
      { id: "teams", x: -1, y: 0, w: 4, h: 2 },  // x 음수
      { id: "notices", x: 0, y: 0, w: 0, h: 2 }, // w 0
      { id: "focus", x: 0, y: 0, w: 4, h: 2 },
      { id: "focus", x: 1, y: 1, w: 4, h: 2 },   // 중복 id
    ]));
    expect(tiles.map(t => t.id)).toEqual(["focus"]);
  });

  it("배열이 아니거나 깨진 JSON은 빈 배열", () => {
    expect(parseDashboard("null")).toEqual([]);
    expect(parseDashboard("{not json")).toEqual([]);
    expect(parseDashboard(undefined)).toEqual([]);
  });
});
