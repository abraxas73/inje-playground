import { describe, expect, it } from "vitest";
import { parseDetailUnits, DETAIL_UNITS_MAX } from "@/lib/rfp/mapping/detail-items";

describe("parseDetailUnits", () => {
  it("1단 리스트(○ 여러 줄)는 항목마다 한 단위", () => {
    const r = parseDetailUnits("○ 첫째 요구\n○ 둘째 요구\n○ 셋째 요구");
    expect(r.flat).toBe(false);
    expect(r.nested).toBe(false);
    expect(r.units.map((u) => [u.key, u.label, u.childCount])).toEqual([
      ["1", "첫째 요구", 0], ["2", "둘째 요구", 0], ["3", "셋째 요구", 0],
    ]);
  });

  it("2depth는 1단 항목으로 묶고 하위 줄을 텍스트에 붙인다", () => {
    const r = parseDetailUnits([
      "○ 가상화 기능 제공",
      "- KVM 기반",
      "- 라이브 마이그레이션",
      "○ 백업 기능 제공",
      "※ 스케줄 백업 포함",
    ].join("\n"));
    expect(r.nested).toBe(true);
    expect(r.units).toHaveLength(2);
    expect(r.units[0]).toMatchObject({ key: "1", label: "가상화 기능 제공", childCount: 2 });
    expect(r.units[0].text).toContain("- KVM 기반");
    expect(r.units[1]).toMatchObject({ key: "2", label: "백업 기능 제공", childCount: 1 });
  });

  it("글머리 없는 줄은 바로 위 단위의 이어지는 내용", () => {
    const r = parseDetailUnits("○ 첫째 요구\n이어지는 설명\n○ 둘째 요구");
    expect(r.units).toHaveLength(2);
    expect(r.units[0].text).toBe("○ 첫째 요구\n이어지는 설명");
    expect(r.units[0].childCount).toBe(1);
  });

  it("목록 앞 머리말은 첫 단위에 붙는다", () => {
    const r = parseDetailUnits("다음 기능을 제공해야 함\n1) 첫째\n2) 둘째");
    expect(r.units).toHaveLength(2);
    expect(r.units[0].text.startsWith("다음 기능을 제공해야 함")).toBe(true);
    expect(r.units[0].label).toBe("첫째");
  });

  it("하위 글머리만 있으면 그것을 1단 목록으로 본다", () => {
    const r = parseDetailUnits("- 첫째\n- 둘째\n- 셋째");
    expect(r.flat).toBe(false);
    expect(r.units.map((u) => u.label)).toEqual(["첫째", "둘째", "셋째"]);
  });

  it("글머리가 없거나 1단 항목이 하나면 전체가 한 단위(예전과 같은 요구사항 단위)", () => {
    const one = parseDetailUnits("서비스 현황을 통합 조회할 수 있어야 한다. 운영 지표도 포함한다.");
    expect(one.flat).toBe(true);
    expect(one.units).toHaveLength(1);
    expect(one.units[0].key).toBe("1");

    const single = parseDetailUnits("○ 다음을 제공\n- A\n- B");
    expect(single.units).toHaveLength(1);
    expect(single.units[0].text).toContain("- B");
  });

  it("빈 세부 내용은 단위가 없다", () => {
    expect(parseDetailUnits("").units).toEqual([]);
    expect(parseDetailUnits("   \n \n").units).toEqual([]);
  });

  it("단위 수 상한을 넘으면 나머지는 마지막 단위에 붙는다", () => {
    const r = parseDetailUnits(Array.from({ length: DETAIL_UNITS_MAX + 5 }, (_, i) => `○ 항목 ${i + 1}`).join("\n"));
    expect(r.units).toHaveLength(DETAIL_UNITS_MAX);
    expect(r.units.at(-1)!.childCount).toBe(5);
  });

  it("라벨은 글머리를 떼고 길면 자른다", () => {
    const long = "○ " + "가".repeat(200);
    expect(parseDetailUnits(`${long}\n○ 둘째`).units[0].label.endsWith("…")).toBe(true);
    expect(parseDetailUnits(`${long}\n○ 둘째`).units[0].label.length).toBeLessThanOrEqual(121);
  });
});
