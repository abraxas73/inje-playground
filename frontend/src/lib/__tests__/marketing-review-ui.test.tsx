import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewPanel from "@/components/marketing/ReviewPanel";
import { emptyContact, type Submission } from "@/lib/marketing/types";
import { validateContact } from "@/lib/marketing/validation";
const data = { ...emptyContact(), company: "한빛", name: "김서연", email: "test@example.com" };
const submission: Submission = { id: "s1", data, target_id: null, clear_fields: [], validation: validateContact(data, [], []), status: "pending", version: 1, created_at: "2026-09-14T00:00:00Z", submitted_by: "u1", submitter: "제출자", division: "사업부문", source: {}, result_contact_id: null };
function mock(conflicts: { key: string; message: string }[] = []) {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.includes("view=submission") ? { events: [], validations: [] } : JSON.parse(String(options?.body ?? "{}")).action === "check" ? { token: "latest", checkedAt: "2026-09-14T00:00:00Z", conflicts } : { submission, validation: submission.validation, contacts: [], organizations: [] } })); vi.stubGlobal("fetch", fetch); return fetch;
}
afterEach(() => vi.unstubAllGlobals());
describe("marketing review approval gate", () => {
  it("requires latest final-value check, confirmation and reason", async () => {
    const fetch = mock(); const saved = vi.fn(); render(<ReviewPanel submission={submission} reviewer onSaved={saved} onResubmit={() => {}} />);
    const approve = screen.getByRole("button", { name: "승인 후 Master 반영" }); expect(approve).toBeDisabled();
    await waitFor(() => expect(screen.queryByText("최신 Master와 비교하고 있습니다…")).not.toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("동일 인물·법인 여부, 분류 또는 반려 사유를 기록하세요."), { target: { value: "별도 법인과 담당자 확인 완료" } });
    fireEvent.click(screen.getByRole("checkbox")); expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "최종값 재검증" })); await screen.findByText(/추가 확인 항목 없음/);
    fireEvent.click(screen.getByRole("checkbox")); expect(approve).toBeEnabled();
    fireEvent.change(screen.getByLabelText("최종 성명"), { target: { value: "변경 이름" } }); expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "최종값 재검증" })); await waitFor(() => expect(screen.getByRole("button", { name: "최종값 재검증" })).toBeEnabled());
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(approve); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ action: "approve", final: { name: "변경 이름" } });
  });
  it("requires a separate resolution for every reported conflict", async () => {
    const fetch = mock([{ key: "candidate", message: "기존 동명이인 후보" }]); render(<ReviewPanel submission={submission} reviewer onSaved={() => {}} onResubmit={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "최종값 재검증" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "최종값 재검증" })); await screen.findByText(/기존 동명이인 후보/);
    fireEvent.change(screen.getByPlaceholderText("동일 인물·법인 여부, 분류 또는 반려 사유를 기록하세요."), { target: { value: "승인 근거" } });
    fireEvent.click(screen.getByLabelText(/반영 대상, 동일 인물/)); const approve = screen.getByRole("button", { name: "승인 후 Master 반영" }); expect(approve).toBeDisabled();
    fireEvent.change(screen.getByLabelText("확인 항목·충돌 해결 근거"), { target: { value: "연락하여 별도 인물임을 확인" } });
    fireEvent.click(screen.getByLabelText("모든 관리 기준과 충돌을 확인하고 근거를 기록했습니다."));
    fireEvent.click(screen.getByLabelText(/반영 대상, 동일 인물/)); expect(approve).toBeEnabled(); fireEvent.click(approve);
    await waitFor(() => expect(JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string).resolution).toEqual({ token: "latest", reason: "연락하여 별도 인물임을 확인" }));
  });
  it("keeps approval blocked when final email belongs to another Contact", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.includes("view=submission") ? { events: [], validations: [] } : JSON.parse(String(options?.body ?? "{}")).action === "check" ? { token: "latest", checkedAt: submission.created_at, conflicts: [], blockingErrors: ["다른 Contact의 이메일"] } : { submission, validation: submission.validation, contacts: [], organizations: [] } })));
    render(<ReviewPanel submission={submission} reviewer onSaved={() => {}} onResubmit={() => {}} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "최종값 재검증" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "최종값 재검증" })); await screen.findByText("다른 Contact의 이메일");
    fireEvent.change(screen.getByPlaceholderText("동일 인물·법인 여부, 분류 또는 반려 사유를 기록하세요."), { target: { value: "확인 완료" } });
    fireEvent.click(screen.getByLabelText(/반영 대상, 동일 인물/));
    expect(screen.getByRole("button", { name: "승인 후 Master 반영" })).toBeDisabled();
  });
  it("shows rejection reason to the submitter and hides review actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events: [{ id: "e", action: "반려", actor_name: "검수자", created_at: submission.created_at, reason: "회사명 재확인 요청" }], validations: [] }) }));
    render(<ReviewPanel submission={{...submission, status: "rejected"}} reviewer={false} onSaved={() => {}} onResubmit={() => {}} />);
    expect(await screen.findByText("회사명 재확인 요청")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "승인 후 Master 반영" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "내용 수정 후 다시 제출" })).toBeInTheDocument();
  });
});
