import { describe, expect, it } from "vitest";
import { sourceFreshness } from "@/lib/rfp/catalog/freshness";

describe("sourceFreshness — confluence", () => {
  const base = { kind: "confluence" as const, importedAt: "2026-09-07T00:00:00.000Z" };
  it("원본 버전이 저장된 버전보다 크면 갱신 필요", () => {
    const r = sourceFreshness({ ...base, pageVersion: 3, currentVersion: 5 });
    expect(r.state).toBe("stale");
    expect(r.label).toBe("갱신 필요");
    expect(r.detail).toContain("v5");
    expect(r.detail).toContain("v3");
  });
  it("같으면 최신(원본이 더 낮아도 최신으로 본다)", () => {
    expect(sourceFreshness({ ...base, pageVersion: 5, currentVersion: 5 }).state).toBe("fresh");
    expect(sourceFreshness({ ...base, pageVersion: 6, currentVersion: 5 }).state).toBe("fresh");
  });
  it("가져온 적이 없으면 가져오기 필요", () => {
    expect(sourceFreshness({ kind: "confluence", importedAt: null, currentVersion: 5 }).state).toBe("never");
  });
  it("원본 버전을 못 읽거나 저장된 버전이 없으면 확인 불가", () => {
    expect(sourceFreshness({ ...base, pageVersion: 3, currentVersion: null }).state).toBe("unknown");
    expect(sourceFreshness({ ...base, pageVersion: null, currentVersion: 5 }).state).toBe("unknown");
    expect(sourceFreshness({ ...base, pageVersion: 3, currentVersion: 0 }).state).toBe("unknown");
  });
  it("확인 실패 사유가 있으면 그 문구를 그대로 보여준다", () => {
    const r = sourceFreshness({ ...base, pageVersion: 3, error: "권한 없음(403)" });
    expect(r).toMatchObject({ state: "unknown", label: "확인 불가", detail: "권한 없음(403)" });
  });
});

describe("sourceFreshness — xlsx", () => {
  const base = { kind: "xlsx" as const, importedAt: "2026-09-07T05:00:00.000Z" };
  it("가져온 뒤 파일이 수정됐으면 갱신 필요", () => {
    expect(sourceFreshness({ ...base, currentModifiedAt: "2026-09-07T06:00:00.000Z" }).state).toBe("stale");
  });
  it("가져온 시각 이후 수정이 없으면 최신", () => {
    expect(sourceFreshness({ ...base, currentModifiedAt: "2026-09-06T23:00:00.000Z" }).state).toBe("fresh");
  });
  it("수정 시각을 못 읽거나 형식이 깨지면 확인 불가", () => {
    expect(sourceFreshness({ ...base, currentModifiedAt: null }).state).toBe("unknown");
    expect(sourceFreshness({ ...base, currentModifiedAt: "어제" }).state).toBe("unknown");
  });
});
