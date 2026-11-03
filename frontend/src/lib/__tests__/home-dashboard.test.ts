import { describe, it, expect } from "vitest";
import { decodeDashboard, encodeDashboard, parseDashboard, rescale } from "@/lib/home-dashboard";

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

describe("24칸 그리드 호환", () => {
  it("24칸 단위 검증 — x+w<=24, h<=80", () => {
    const tiles = parseDashboard(JSON.stringify([
      { id: "briefing", x: 16, y: 0, w: 8, h: 80 },
      { id: "mails", x: 20, y: 0, w: 8, h: 2 }, // 28 > 24
    ]), 24);
    expect(tiles.map((t) => t.id)).toEqual(["briefing"]);
  });

  it("옛 배열 값은 12칸으로 읽어 두 배, {cols:24} 값은 그대로", () => {
    expect(decodeDashboard(JSON.stringify([{ id: "mails", x: 6, y: 3, w: 6, h: 3 }]))).toEqual([{ id: "mails", x: 12, y: 6, w: 12, h: 6 }]);
    const fine = [{ id: "mails", x: 13, y: 5, w: 7, h: 3 }];
    expect(decodeDashboard(JSON.stringify(encodeDashboard(fine)))).toEqual(fine);
    expect(decodeDashboard(encodeDashboard(fine))).toEqual(fine); // 템플릿 jsonb
    expect(decodeDashboard("{bad")).toEqual([]);
  });

  it("24→12는 위치 내림·크기 올림, 오른쪽 넘침은 폭을 줄인다", () => {
    expect(rescale([{ id: "a", x: 13, y: 5, w: 11, h: 1 }], 24, 12)).toEqual([{ id: "a", x: 6, y: 2, w: 6, h: 1 }]);
    expect(rescale([{ id: "a", x: 23, y: 0, w: 1, h: 3 }], 24, 12)).toEqual([{ id: "a", x: 11, y: 0, w: 1, h: 2 }]);
    const old = [{ id: "a", x: 6, y: 3, w: 6, h: 3 }];
    expect(rescale(rescale(old, 12, 24), 24, 12)).toEqual(old);
  });
});
