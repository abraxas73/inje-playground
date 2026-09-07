import { describe, it, expect } from "vitest";
import { ALL_DETAIL_LABEL, groupRowsByDetailText, isDetailScoped } from "@/lib/rfp/mapping/detail-groups";
import type { MappingRow } from "@/lib/rfp/mapping/types";

const row = (id: string, sortOrder: number, detailKey: string | null, detailText?: string): MappingRow => ({
  id, requirementId: "q1", solutionCode: "secloudit", featureId: "f1", verdict: "candidate",
  rationale: "이유", evidenceUrl: null, edited: false, sortOrder, detailKey, detailText: detailText ?? null,
});

const listDetails = "○ 첫째 항목\n - 하위\n○ 둘째 항목\n○ 셋째 항목";

describe("groupRowsByDetail", () => {
  it("세부 내용이 목록이면 항목마다 그룹, 매핑 없는 항목도 빈 그룹으로 남는다", () => {
    const groups = groupRowsByDetailText([row("a", 10, "1"), row("b", 11, "1"), row("c", 20, "2")], listDetails);
    expect(groups.map((g) => g.key)).toEqual(["1", "2", "3"]);
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1, 0]);
    expect(groups[0].label).toBe("첫째 항목");
    expect(groups[0].text).toBe("○ 첫째 항목\n- 하위");
    expect(isDetailScoped(groups)).toBe(true);
  });

  it("detail_key가 없는 옛 행은 '요구사항 전체' 그룹으로 맨 앞에 온다", () => {
    const groups = groupRowsByDetailText([row("a", 5, null), row("b", 10, "2")], listDetails);
    expect(groups.map((g) => g.key)).toEqual([null, "1", "2", "3"]);
    expect(groups[0].label).toBe(ALL_DETAIL_LABEL);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("세부 내용을 고쳐 없어진 키의 행은 저장된 라벨로 뒤에 남는다(stale)", () => {
    const groups = groupRowsByDetailText([row("a", 10, "1"), row("z", 90, "9", "옛 항목")], listDetails);
    expect(groups.map((g) => g.key)).toEqual(["1", "2", "3", "9"]);
    const stale = groups[3];
    expect(stale.stale).toBe(true);
    expect(stale.label).toBe("옛 항목");
    expect(stale.rows.map((r) => r.id)).toEqual(["z"]);
  });

  it("목록이 아니거나 항목이 하나면 요구사항 전체 한 그룹(행의 detail_key는 무시)", () => {
    const groups = groupRowsByDetailText([row("a", 0, null), row("b", 1, "1")], "세부 내용 한 덩어리");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBeNull();
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(isDetailScoped(groups)).toBe(false);
  });

  it("행은 sortOrder → id 순으로 정렬된다", () => {
    const groups = groupRowsByDetailText([row("b", 11, "1"), row("a", 11, "1"), row("c", 1, "1")], listDetails);
    expect(groups[0].rows.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});
