import { describe, expect, it } from "vitest";
import { numifyOfficeRow, summarizeOffice, surfaceLabel, surfacesText, type OfficeDailyRow } from "@/lib/claude-usage/office-usage";

const row = (over: Partial<OfficeDailyRow> & { day: string; user_email: string; surface: string }): OfficeDailyRow => ({
  org_id: "org-ax", turns: 0, sessions: 0, model_calls: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, tool_calls: 0, tool_errors: 0, file_uploads: 0, ...over,
});

describe("summarizeOffice", () => {
  it("사용자별 합·활성일·표면 분포, 표면별·일별(기간 전체 채움) 집계", () => {
    const s = summarizeOffice([
      row({ day: "2026-09-04", user_email: "a@x.com", surface: "sheet", turns: 3, sessions: 1, model_calls: 10, input_tokens: 2480, output_tokens: 6689, tool_calls: 8, file_uploads: 1 }),
      row({ day: "2026-09-05", user_email: "a@x.com", surface: "doc", turns: 1, sessions: 1, model_calls: 2, output_tokens: 100, org_id: "org-s1" }),
      row({ day: "2026-09-05", user_email: "b@x.com", surface: "slide", turns: 2, sessions: 1, model_calls: 4, output_tokens: 300 }),
    ], "2026-09-03", "2026-09-06");
    expect(s.totals).toMatchObject({ turns: 6, model_calls: 16, output_tokens: 7089, active_users: 2, active_days: 3, file_uploads: 1 });
    const a = s.users.find((u) => u.user_email === "a@x.com")!;
    expect(a).toMatchObject({ turns: 4, active_days: 2, orgs: ["org-ax", "org-s1"], surfaces: { sheet: 3, doc: 1 } });
    expect(s.users[0].user_email).toBe("a@x.com"); // 턴 많은 순
    expect(s.surfaces.map((x) => [x.surface, x.turns, x.users])).toEqual([["sheet", 3, 1], ["doc", 1, 1], ["slide", 2, 1]]);
    expect(s.daily.map((d) => d.day)).toEqual(["2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(s.daily[2]).toEqual({ day: "2026-09-05", turns: 3, users: 2, output_tokens: 400 });
  });

  it("빈 입력이면 총계 0과 기간만큼의 빈 일별 행", () => {
    const s = summarizeOffice([], "2026-09-01", "2026-09-02");
    expect(s.totals.turns).toBe(0);
    expect(s.users).toEqual([]);
    expect(s.daily).toHaveLength(2);
  });
});

describe("numifyOfficeRow / labels", () => {
  it("RPC의 numeric 문자열을 숫자로, 이메일은 소문자로", () => {
    const r = numifyOfficeRow({ day: "2026-09-04", org_id: "o", user_email: "A@X.com", surface: "sheet", turns: 3, input_tokens: "2480", output_tokens: "6689", file_uploads: "1" });
    expect(r).toMatchObject({ user_email: "a@x.com", turns: 3, input_tokens: 2480, output_tokens: 6689, file_uploads: 1, cache_read_tokens: 0 });
  });
  it("표면 라벨과 분포 문자열", () => {
    expect(surfaceLabel("sheet")).toBe("Excel");
    expect(surfaceLabel("mail")).toBe("Outlook");
    expect(surfaceLabel(null)).toBe("기타");
    expect(surfacesText({ slide: 2, sheet: 3, doc: 0 })).toBe("Excel 3 · PowerPoint 2");
    expect(surfacesText({})).toBe("—");
  });
});
