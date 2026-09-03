import { describe, expect, it } from "vitest";
import { resolveAndMergeGitlabRows, resolveCommitterEmail, type EmailResolver } from "@/lib/work-metrics/email-resolve";

const r: EmailResolver = {
  known: new Set(["kim@innogrid.com", "popt0@innogrid.com", "sdjo@innogrid.com", "admin@innogrid.com", "seolin.lee@innogrid.com"]),
  manual: new Map([["taking@duck.com", "Kim@innogrid.com"]]),
};

describe("resolveCommitterEmail", () => {
  it("조직도에 있는 이메일은 그대로(소문자화)", () => {
    expect(resolveCommitterEmail("Kim@Innogrid.com", r)).toBe("kim@innogrid.com");
  });
  it("수동 매핑이 최우선", () => {
    expect(resolveCommitterEmail("taking@duck.com", r)).toBe("kim@innogrid.com");
  });
  it("오타 도메인·구 회사 도메인은 로컬파트가 조직도에 있으면 회사 이메일로", () => {
    expect(resolveCommitterEmail("sdjo@injeinc.co.kr", r)).toBe("sdjo@innogrid.com");
    expect(resolveCommitterEmail("seolin.lee@nhn.com", r)).toBe("seolin.lee@innogrid.com");
    expect(resolveCommitterEmail("popt0@inngorid.com", r)).toBe("popt0@innogrid.com");
  });
  it("개인 도메인은 로컬파트 5자 이상일 때만 매핑(짧은 일반 계정 오탐 방지)", () => {
    expect(resolveCommitterEmail("popt0@naver.com", r)).toBe("popt0@innogrid.com");
    expect(resolveCommitterEmail("sdjo@gmail.com", r)).toBe("sdjo@gmail.com");
    expect(resolveCommitterEmail("admin@gmail.com", r)).toBe("admin@innogrid.com"); // 5자 — 규칙상 매핑됨(조직도에 admin@가 있을 때만)
  });
  it("조직도에 없는 로컬파트·회사 도메인·이메일 아님은 그대로", () => {
    expect(resolveCommitterEmail("unknown@nhn.com", r)).toBe("unknown@nhn.com");
    expect(resolveCommitterEmail("nobody@innogrid.com", r)).toBe("nobody@innogrid.com");
    expect(resolveCommitterEmail("jenkins", r)).toBe("jenkins");
  });
});

describe("resolveAndMergeGitlabRows", () => {
  it("같은 사람으로 합쳐진 행의 숫자 컬럼을 더한다", () => {
    const rows = [
      { day: "2026-09-01", user_email: "kim@innogrid.com", project_path: "g/p", commits: 3, claude_commits: 1, mrs_merged: 0, mr_lead_hours_sum: 0 },
      { day: "2026-09-01", user_email: "taking@duck.com", project_path: "g/p", commits: 2, claude_commits: 2, mrs_merged: 1, mr_lead_hours_sum: 4.5 },
      { day: "2026-09-01", user_email: "kim@innogrid.com", project_path: "g/other", commits: 1, claude_commits: 0, mrs_merged: 0, mr_lead_hours_sum: 0 },
    ];
    const out = resolveAndMergeGitlabRows(rows, (e) => resolveCommitterEmail(e, r)).sort((a, b) => a.project_path.localeCompare(b.project_path));
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ user_email: "kim@innogrid.com", project_path: "g/p", commits: 5, claude_commits: 3, mrs_merged: 1, mr_lead_hours_sum: 4.5 });
  });
});
