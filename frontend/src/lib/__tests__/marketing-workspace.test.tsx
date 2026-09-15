import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MarketingWorkspace from "@/components/marketing/MarketingWorkspace";
import { emptyContact } from "@/lib/marketing/types";
vi.mock("@/components/marketing/ReviewPanel", () => ({ default: () => <div>검수 상세</div> }));
const rows = {
  master: [{ id: "c1", db_id: "TEST-001", data: { ...emptyContact(), name: "테스트 연락처" } }],
  organizations: [{ id: "o1", name: "테스트 기관", category: "IT기업", aliases: [] }],
  queue: [{ id: "s1", data: { ...emptyContact(), name: "테스트 제출" }, validation: { kind: "신규 등록" }, created_at: "2026-09-14T00:00:00Z" }],
  history: [{ id: "h1", action: "테스트 이력", created_at: "2026-09-14T00:00:00Z" }],
};
const pending: { view: string; params: URLSearchParams; resolve: (r: unknown) => void }[] = [];
beforeEach(() => {
  vi.useFakeTimers(); pending.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const params = new URL(url, "https://test.local").searchParams;
    const view = params.get("view")!;
    if (view === "organization-conflicts") return Promise.resolve({ ok: true, json: async () => ({ rows: [] }) });
    if (view === "meta") return Promise.resolve({ ok: true, json: async () => ({ total: 1, pending: 1, reviewer: true, identity: {} }) });
    // Deliberately ignore abort to exercise stale response protection.
    return new Promise(resolve => pending.push({ view, params, resolve }));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(250); }); }
async function reply(index: number, total = 1) {
  const req = pending[index];
  await act(async () => req.resolve({ ok: true, json: async () => ({ rows: rows[req.view as keyof typeof rows], total }) }));
}
it("switches between populated tabs without interpreting the previous rows as a new type", async () => {
  render(<MarketingWorkspace />); await tick(); await reply(0);
  expect(screen.getByRole("tab", { name: "Master DB" })).toHaveAttribute("aria-selected", "true");
  const headers = screen.getAllByRole("columnheader");
  expect(headers.filter(header => header.getAttribute("scope") === "col")).toHaveLength(18);
  expect(headers.filter(header => header.getAttribute("scope") === "colgroup").map(header => [header.textContent, header.getAttribute("colspan")])).toEqual([
    ["회사·기관 분류", "1"], ["기본정보", "7"], ["원본정보", "3"], ["Eco Partner 연계", "5"], ["관리정보", "2"],
  ]);
  for (const [label, content] of [["검수 대기", "테스트 제출"], ["회사·기관", "테스트 기관"], ["검수 대기", "테스트 제출"], ["변경 이력", "테스트 이력"], ["Master DB", "TEST-001"]]) {
    fireEvent.click(screen.getByRole("tab", { name: new RegExp(label) }));
    expect(screen.getByText("데이터를 불러오고 있습니다…")).toBeInTheDocument();
    await tick(); await reply(pending.length - 1);
    expect(screen.getByText(content, { exact: false })).toBeInTheDocument();
  }
});
it("ignores an old request that completes after the current tab response", async () => {
  render(<MarketingWorkspace />); await tick();
  fireEvent.click(screen.getByRole("tab", { name: "회사·기관" })); await tick(); await reply(1); await reply(0);
  expect(screen.getByText("테스트 기관")).toBeInTheDocument();
  expect(screen.queryByText("테스트 제출")).not.toBeInTheDocument();
});
it("opens the Master record with its own email history section", async () => {
  render(<MarketingWorkspace/>); await tick(); await reply(0);
  fireEvent.click(screen.getByRole("button", { name: "TEST-001" }));
  const contactRequest = pending.find(p => p.view === "contact")!;
  await act(async () => contactRequest.resolve({ ok: true, json: async () => ({ contact: rows.master[0], sources: [], events: [] }) }));
  expect(screen.getByRole("region", { name: "이메일 검증 이력" })).toBeInTheDocument();
  const historyRequest = pending.find(p => p.view === null)!;
  await act(async () => historyRequest.resolve({ ok: true, json: async () => ({ rows: [], total: 0, pageSize: 20 }) }));
  expect(screen.getByText("아직 이 레코드의 이메일 검증 이력이 없습니다.")).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes("/email-checks/contacts/c1?page=1"))).toBe(true);
});
it("sorts on the server, resets pagination, preserves filters and table, and ignores an older sort response", async () => {
  render(<MarketingWorkspace />); await tick(); await reply(0, 51);
  fireEvent.change(screen.getByLabelText("회사 분류"), { target: { value: "IT기업" } }); await tick(); await reply(1, 51);
  fireEvent.click(screen.getByRole("button", { name: "다음 페이지" })); await tick(); await reply(2, 51);
  expect(pending[2].params.get("page")).toBe("2");
  const region = screen.getByRole("region", { name: /Master DB 전체 컬럼 표/ });
  fireEvent.click(screen.getByRole("button", { name: "회사명 오름차순 정렬" })); await tick();
  expect(screen.getByRole("region", { name: /Master DB 전체 컬럼 표/ })).toBe(region);
  expect(Object.fromEntries(pending[3].params)).toMatchObject({ sort: "company", direction: "asc", page: "1", category: "IT기업" });
  fireEvent.click(screen.getByRole("button", { name: "회사명 내림차순 정렬" })); await tick();
  expect(pending[4].params.get("direction")).toBe("desc");
  await reply(4, 51); await reply(3, 99);
  expect(screen.getByRole("button", { name: "회사명 오름차순 정렬" }).closest("th")).toHaveAttribute("aria-sort", "descending");
  expect(screen.getByText("51건 · 페이지당 25건")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "성명 오름차순 정렬" })); await tick(); await reply(5, 51);
  expect(Object.fromEntries(pending[5].params)).toMatchObject({ sort: "name", direction: "asc" });
});
