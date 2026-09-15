import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EmailCheckDialog from "@/components/marketing/EmailCheckDialog";
import EmailProfileEditor from "@/components/marketing/EmailProfileEditor";
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
afterEach(() => { vi.unstubAllGlobals(); push.mockReset(); });
it("starts all filtered contacts independently of selected page IDs", async () => {
 const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.body ? { id: "run1" } : { total: 7294 } })); vi.stubGlobal("fetch", fetch);
 render(<EmailCheckDialog filters={{ category: "IT기업" }} ids={["c1"]} filteredCount={2149} onClose={() => {}}/>);
 await screen.findByText("전체 Master · 7,294건"); fireEvent.change(screen.getByLabelText("이메일 검사 대상"), { target: { value: "filtered" } }); fireEvent.click(screen.getByRole("button", { name: "2,149건 검사 시작" }));
 await waitFor(() => expect(push).toHaveBeenCalledWith("/marketing/email-checks/run1")); const body = JSON.parse(String(fetch.mock.calls.find(([, o]) => o?.body)?.[1]?.body)); expect(body).toMatchObject({ scope: "filtered", ids: [], filters: { category: "IT기업" } });
});
it("requires confirmation evidence and submits both profile and organization versions", async () => {
 const fetch = vi.fn(async (_url: string, options?: RequestInit) => ({ ok: true, json: async () => options?.body ? {} : { organization: { id: "o1", name: "이노그리드", version: 4 }, profile: { version: 2, website: "https://innogrid.com/", domains: ["innogrid.com"] }, history: [], editable: true } })); vi.stubGlobal("fetch", fetch); const saved = vi.fn();
 render(<EmailProfileEditor organizationId="o1" onClose={() => {}} onSaved={saved}/>); await screen.findByDisplayValue("https://innogrid.com/"); expect(screen.getByRole("button", { name: "확인한 기준 저장" })).toBeDisabled();
 fireEvent.change(screen.getByLabelText("확인·변경 근거"), { target: { value: "담당자 확인" } }); fireEvent.click(screen.getByRole("button", { name: "확인한 기준 저장" })); await waitFor(() => expect(saved).toHaveBeenCalled());
 expect(JSON.parse(String(fetch.mock.calls.find(([, o]) => o?.body)?.[1]?.body))).toMatchObject({ id: "o1", version: 2, organizationVersion: 4, reason: "담당자 확인" });
});
