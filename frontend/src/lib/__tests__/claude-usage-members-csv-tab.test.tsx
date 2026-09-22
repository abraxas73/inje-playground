import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MembersCsvTab from "@/components/admin/claude-usage/MembersCsvTab";
import type { ClaudeOrg } from "@/types/claude-usage";

afterEach(() => vi.unstubAllGlobals());

const ORGS: ClaudeOrg[] = [{ id: "org-1", name: "Innogrid-ax", category: "team" } as ClaudeOrg];

const response = (unknown: string[]) => ({
  imports: [{ id: "i1", org_id: "org-1", period_start: "2026-08-21", period_end: "2026-09-20", filename: "members-analytics.csv", row_count: 1, unknown_headers: unknown, created_at: "2026-09-21T00:05:00Z" }],
  rows: [],
  period: { start: "2026-08-21", end: "2026-09-20" },
});

it("CSV에 매핑되지 않은 칼럼이 있으면 경고와 배지를 보여준다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => response(["Design Sessions", "Design Artifacts"]) })));
  render(<MembersCsvTab orgs={ORGS} />);
  expect(await screen.findByText(/CSV에 모르는 칼럼이 있어 저장하지 않았습니다/)).toBeInTheDocument();
  expect(screen.getByText("Design Sessions, Design Artifacts")).toBeInTheDocument();
  expect(screen.getByText("미매핑 칼럼 2")).toBeInTheDocument();
});

it("모두 아는 칼럼이면 경고가 없다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => response([]) })));
  render(<MembersCsvTab orgs={ORGS} />);
  expect(await screen.findByText(/수집 이력/)).toBeInTheDocument();
  expect(screen.queryByText(/모르는 칼럼/)).not.toBeInTheDocument();
});
