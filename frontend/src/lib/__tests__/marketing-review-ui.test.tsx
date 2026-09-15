import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReviewPanel from "@/components/marketing/ReviewPanel";
import { emptyContact, type Submission } from "@/lib/marketing/types";
import { validateContact } from "@/lib/marketing/validation";
const data = { ...emptyContact(), company: "한빛", name: "김서연", email: "test@example.com" };
const submission: Submission = { id: "s1", data, target_id: null, clear_fields: [], validation: validateContact(data, [], []), status: "pending", version: 1, created_at: "2026-09-14T00:00:00Z", submitted_by: "u1", submitter: "제출자", division: "사업부문", source: {}, result_contact_id: null };
function mock(conflicts: { key: string; message: string }[] = []) {
  const fetch = vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.includes("view=submission") ? { events: [], validations: [] } : JSON.parse(String(options?.body ?? "{}")).action === "check" ? { token: "latest", checkedAt: "2026-09-14T00:00:00Z", conflicts } : { submission, validation: submission.validation, contacts: [], organizations: [{id:"o1",name:"한빛",category:"IT기업",aliases:[],version:1}] } })); vi.stubGlobal("fetch", fetch); return fetch;
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
  it("requires evidence and confirmation for reported conflicts", async () => {
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
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => ({ ok: true, json: async () => url.includes("view=submission") ? { events: [], validations: [] } : JSON.parse(String(options?.body ?? "{}")).action === "check" ? { token: "latest", checkedAt: submission.created_at, conflicts: [], blockingErrors: ["다른 Contact의 이메일"] } : { submission, validation: submission.validation, contacts: [], organizations: [{id:"o1",name:"한빛",category:"IT기업",aliases:[],version:1}] } })));
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

it("allows rejecting with a reason without approval verification or confirmation", async () => {
 const fetch = mock(); const saved = vi.fn(); render(<ReviewPanel submission={submission} reviewer onSaved={saved} onResubmit={() => {}}/>);
 await waitFor(() => expect(screen.getByRole("button", { name: "반려 사유 입력" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "반려 사유 입력" }));
 expect(screen.getByRole("button", { name: "사유를 저장하고 반려" })).toBeDisabled(); fireEvent.change(screen.getByLabelText("반려 사유"), { target: { value: "회사명 보완된 후속 요청으로 대체" } });
 fireEvent.click(screen.getByRole("button", { name: "사유를 저장하고 반려" })); await waitFor(() => expect(saved).toHaveBeenCalled());
 expect(JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body))).toMatchObject({ action: "reject", reason: "회사명 보완된 후속 요청으로 대체", resolution: null });
 expect(fetch.mock.calls.some(([, options]) => JSON.parse(String(options?.body ?? "{}")).action === "check")).toBe(false);
});
it("explains pending duplicate resolution and shows remaining approval tasks", async () => {
 mock([{ key: "submission:old", message: "다른 검수 대기 제출과 겹칩니다." }]); render(<ReviewPanel submission={submission} reviewer onSaved={() => {}} onResubmit={() => {}}/>);
 await waitFor(() => expect(screen.getByRole("button", { name: "최종값 재검증" })).toBeEnabled()); fireEvent.click(screen.getByRole("button", { name: "최종값 재검증" }));
 await screen.findByText(/후속 보완본이라면 이전 요청을 반려/);
 expect(screen.getByLabelText("승인까지 남은 작업")).toHaveTextContent("확인 항목 1건의 근거 작성 및 확인 체크");
 expect(screen.getByLabelText("승인까지 남은 작업")).toHaveTextContent("검수 사유 / 확인 근거 2자 이상 입력");
 expect(screen.getByText("승인 차단 오류 0건 · 담당자 확인 항목 1건")).toBeInTheDocument();
});

it("keeps the submitter's chosen company ID instead of replacing it with the old Master company", async () => {
 const oldOrg={id:'old-org',name:'기존 회사',category:'IT기업',aliases:[],version:1};
 const newOrg={id:'chosen-org',name:'선택한 회사',category:'금융',aliases:[],version:1};
 const s={...submission,submitted_organization_id:newOrg.id,target_id:'c1'};
 vi.stubGlobal('fetch',vi.fn(async (url:string)=>({ok:true,json:async()=>url.includes('view=submission')?{events:[],validations:[]}:{submission:s,validation:{...s.validation,targetId:'c1'},contacts:[{id:'c1',db_id:'DB-001',data,organization_id:oldOrg.id,organization:oldOrg,version:1}],organizations:[oldOrg,newOrg]}})));
 render(<ReviewPanel submission={s} reviewer onSaved={()=>{}} onResubmit={()=>{}}/>);
 expect(await screen.findByText('선택한 회사 · 금융')).toBeInTheDocument();
 expect(screen.getByLabelText('최종 회사명')).toHaveValue('선택한 회사');
 expect(screen.getByLabelText('최종 회사명')).toBeDisabled();
 expect(screen.queryByText('새 회사·기관으로 등록')).not.toBeInTheDocument();
});
