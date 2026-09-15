import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ContactEmailHistory from "@/components/marketing/ContactEmailHistory";
import { HistoryList } from "@/components/marketing/HistoryList";
import type { ContactEmailEvent } from "@/lib/marketing/email/types";
import type { ReviewEvent } from "@/lib/marketing/types";

const event: ContactEmailEvent = {
 id: "event1", email_result_id: "result1", created_at: "2026-09-15T00:00:00Z", actor_name: "검수 담당자", stale: true,
 source: { runId: "run1", resultId: "result1" },
 after_data: { contact: { id: "c1", db_id: "DB-001", version: 2, organization_id: "o1", organization_version: 1, name: "담당", company: "회사", email: "old@example.com", profile: null } },
 validation_snapshot: { state: "review", engine: "test-v1", relationship: { state: "review", code: "missing", message: "당시 승인 회사 기준 없음" }, mail: { state: "pass", code: "mx", message: "MX 응답 확인", checkedAt: "2026-09-15T00:00:00Z", domain: "example.com", mx: [{ exchange: "mx.example.com", priority: 10 }] }, website: { state: "review", code: "candidate", message: "홈페이지 후보", checkedAt: "2026-09-15T00:00:00Z", url: "https://example.com/", title: "<script>bad()</script>" }, mailbox: { state: "review", code: "unknown", message: "개별 메일함 미확인" } },
};
afterEach(() => vi.unstubAllGlobals());
it("shows original checked email, actor, evidence, stale warning, and paginated attempts on a Master record", async () => {
 const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ rows: [{ ...event, id: url.includes("page=2") ? "older" : event.id, actor_name: url.includes("page=2") ? "이전 실행자" : event.actor_name }], total: 21, pageSize: 20 }) })); vi.stubGlobal("fetch", fetch);
 render(<ContactEmailHistory contactId="c1"/>);
 await screen.findByText("이메일 검증 이력 · 21건"); expect(screen.getByText("검사 이메일: old@example.com")).toBeInTheDocument();
 expect(screen.getByText(/실행 요청자: 검수 담당자/)).toBeInTheDocument(); expect(screen.getByText(/재검사가 필요합니다/)).toBeInTheDocument();
 fireEvent.click(screen.getByText("검증 내용·판정 근거 보기")); expect(screen.getByText("당시 승인 회사 기준 없음")).toBeVisible(); expect(screen.getByText(/MX: mx.example.com/)).toBeVisible();
 expect(screen.getByText(/페이지 제목: <script>bad\(\)<\/script>/)).toBeVisible(); expect(document.querySelector("script")).toBeNull();
 expect(screen.getByRole("link", { name: "전체 검사 실행 보기" })).toHaveAttribute("href", "/marketing/email-checks/run1");
 fireEvent.click(screen.getByRole("button", { name: "다음 이력" })); await screen.findByText(/실행 요청자: 이전 실행자/);
 expect(fetch).toHaveBeenLastCalledWith("/api/marketing/email-checks/contacts/c1?page=2", expect.anything());
});
it("renders a partial execution-error attempt in the shared audit list without losing its message", () => {
 render(<HistoryList events={[{ ...event, validation_snapshot: { state: "error", message: "네트워크 실행 중단" } } as unknown as ReviewEvent]}/>);
 expect(screen.getByText("실행 오류")).toBeInTheDocument(); fireEvent.click(screen.getByText("검증 내용·판정 근거 보기")); expect(screen.getByText("네트워크 실행 중단")).toBeVisible();
 expect(screen.getByText(/개별 메일함의 실제 존재·수신 성공은 미확인/)).toBeVisible();
});
it("ignores a late previous Contact response, and distinguishes failure from no history", async () => {
 let resolveOld: (value: unknown) => void = () => {};
 const fetch = vi.fn((url: string) => url.includes("c1") ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ok: true, json: async () => ({ rows: [], total: 0, pageSize: 20 }) })); vi.stubGlobal("fetch", fetch);
 const { rerender } = render(<ContactEmailHistory contactId="c1"/>); rerender(<ContactEmailHistory contactId="c2"/>);
 await screen.findByText("아직 이 레코드의 이메일 검증 이력이 없습니다.");
 await act(async () => resolveOld({ ok: true, json: async () => ({ rows: [event], total: 1, pageSize: 20 }) })); expect(screen.queryByText(/old@example.com/)).toBeNull();
 fetch.mockImplementation(() => Promise.resolve({ ok: false, json: async () => ({ error: "이력 조회 실패" }) })); fireEvent.click(screen.getByRole("button", { name: "이력 새로고침" }));
 await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("이력 조회 실패")); expect(screen.queryByText("아직 이 레코드의 이메일 검증 이력이 없습니다.")).toBeNull();
});
