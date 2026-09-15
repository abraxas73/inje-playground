import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ReviewerManagement from "@/components/marketing/ReviewerManagement";
import type { ReviewerDirectory } from "@/lib/marketing/reviewers";
const directory: ReviewerDirectory = {
 canManage: true, canImport: true, total: 2, pageSize: 20,
 rows: [
  { userId: "admin", name: "관리자", email: "admin@example.com", role: "admin", isManager: true, pageAccess: true, explicit: true, canReview: true, grantedAt: "2026-09-14T01:00:00Z", grantedBy: "과거 처리자", version: "admin-version" },
  { userId: "reviewer", name: "담당자", email: "reviewer@example.com", role: "user", isManager: false, pageAccess: true, explicit: true, canReview: true, grantedAt: "2026-09-14T02:00:00Z", grantedBy: "과거 처리자", version: "reviewer-version" },
 ],
 history: [{ id: "e1", user_id: "reviewer", name: "담당자", email: "reviewer@example.com", actor_name: "과거 처리자", enabled: true, reason: "검수자 지정", created_at: "2026-09-14T02:00:00Z" }],
};
const props = { onClose: () => {}, onImport: () => {}, onChanged: () => {}, empty: false };
afterEach(() => vi.unstubAllGlobals());
it("shows actual permissions, grant source, audit metadata, and different admin removal semantics", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => directory })));
 render(<ReviewerManagement {...props}/>);
 const admin = await screen.findByRole("article", { name: "관리자 권한" }); const reviewer = screen.getByRole("article", { name: "담당자 권한" });
 expect(within(admin).getByText("검수 관리자 고정 권한 + 별도 검수자 지정")).toBeInTheDocument();
 expect(within(reviewer).getByText("reviewer@example.com")).toBeInTheDocument(); expect(within(reviewer).getByText("과거 처리자")).toBeInTheDocument();
 expect(screen.getByRole("region", { name: "검수 권한 변경 이력" })).toHaveTextContent("처리자: 과거 처리자");
 expect(screen.queryByRole("button", { name: "관리자 추가 지정 해제" })).toBeNull(); expect(screen.getByText(/고정 검수 관리자입니다/)).toBeInTheDocument();
 expect(screen.getByRole("button", { name: "기존 Master Excel 최초 이관" })).toBeDisabled();
});
it("applies a targeted versioned revoke and reloads the resulting actual permissions", async () => {
 let current = structuredClone(directory); const changed = vi.fn();
 const fetch = vi.fn(async (_url: string, options?: RequestInit) => {
  if (options?.body) { const row = { ...current.rows[1], explicit: false, pageAccess: false, canReview: false }; current = { ...current, rows: current.rows.filter(r => r.userId !== "reviewer") }; return { ok: true, json: async () => ({ changed: true, row }) }; }
  return { ok: true, json: async () => current };
 }); vi.stubGlobal("fetch", fetch); render(<ReviewerManagement {...props} onChanged={changed}/>);
 fireEvent.click(await screen.findByRole("button", { name: "담당자 검수자 해제" })); expect(screen.getByText(/마케팅 접근과 검수 권한이 함께 해제됩니다/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "해제 적용" }));
 await waitFor(() => expect(screen.queryByRole("article", { name: "담당자 권한" })).toBeNull()); expect(changed).toHaveBeenCalledOnce();
 expect(JSON.parse(String(fetch.mock.calls.find(([, options]) => options?.body)?.[1]?.body))).toEqual({ userId: "reviewer", enabled: false, version: "reviewer-version" });
 expect(screen.getByRole("region", { name: "검수 권한 변경 이력" })).toBeInTheDocument();
});
it("keeps the roster readable for non-admins and marks missing audit metadata honestly", async () => {
 vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...directory, canManage: false, canImport: false, rows: [{ ...directory.rows[1], grantedAt: null, grantedBy: null }] }) })));
 render(<ReviewerManagement {...props}/>); await screen.findByRole("article", { name: "담당자 권한" });
 expect(screen.getAllByText("기존 지정 기록 미상")).toHaveLength(2); expect(screen.queryByRole("button", { name: /검수자 해제|검수자 지정|최초 이관/ })).toBeNull();
});
it("refreshes after a conflict without claiming success, and paginates all audit events", async () => {
 const fetch = vi.fn(async (url: string, options?: RequestInit) => options?.body ? { ok: false, json: async () => ({ error: "권한 정보가 변경되었습니다." }) } : { ok: true, json: async () => ({ ...directory, total: 21, history: url.includes("page=2") ? [{ ...directory.history[0], actor_name: "이전 페이지 처리자" }] : directory.history }) }); vi.stubGlobal("fetch", fetch);
 const changed = vi.fn(); render(<ReviewerManagement {...props} onChanged={changed}/>);
 fireEvent.click(await screen.findByRole("button", { name: "담당자 검수자 해제" })); fireEvent.click(screen.getByRole("button", { name: "해제 적용" }));
 await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("권한 정보가 변경되었습니다.")); expect(changed).not.toHaveBeenCalled();
 await screen.findByRole("button", { name: "담당자 검수자 해제" }); fireEvent.click(screen.getByRole("button", { name: "다음 이력" })); await screen.findByText(/처리자: 이전 페이지 처리자/);
 expect(fetch).toHaveBeenLastCalledWith("/api/marketing/reviewers?page=2", expect.anything());
});

it("lets a manager search and grant a new registered candidate without granting management", async () => {
 const candidate = { ...directory.rows[1], userId: "new", name: "신규 담당자", email: "new@example.com", explicit: false, pageAccess: false, canReview: false, version: "candidate-version" }; const fetch = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.body ? { changed: true, row: { ...candidate, explicit: true, pageAccess: true, canReview: true } } : url.includes("q=") ? { rows: [candidate], total: 1 } : directory })); vi.stubGlobal("fetch", fetch);
 render(<ReviewerManagement {...props}/>); await screen.findByRole("region", { name: "검수자 추가" });
 fireEvent.change(screen.getByLabelText("추가할 검수자 이름 또는 이메일"), { target: { value: "신규" } }); fireEvent.click(screen.getByRole("button", { name: "사용자 검색" }));
 fireEvent.click(await screen.findByRole("button", { name: "신규 담당자 지정" })); expect(screen.getByText(/검수자 관리 권한은 부여하지 않습니다/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button", { name: "지정 적용" })); await waitFor(() => expect(fetch.mock.calls.some(([, options]) => options?.body)).toBe(true));
 expect(JSON.parse(String(fetch.mock.calls.find(([, options]) => options?.body)?.[1]?.body))).toEqual({ userId: "new", enabled: true, version: "candidate-version" });
});
