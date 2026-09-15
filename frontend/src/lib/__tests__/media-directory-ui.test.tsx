import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MediaDirectory from "@/components/media-directory/MediaDirectory";
import ImportDialog from "@/components/media-directory/ImportDialog";

const role = vi.hoisted(() => ({ isAdmin: false, loading: false }));
vi.mock("@/hooks/useUserRole", () => ({ useUserRole: () => ({ ...role, role: role.isAdmin ? "admin" : "user", permissions: {}, error: false, canAccessPage: () => true, invalidate: () => {} }) }));
const directory = { outlets: [
  { id: "o1", name: "조선일보", aliases: ["조선"], any_department: false, active: true, updated_at: "2026-09-15T00:00:00Z", departments: [{ id: "d1", outlet_id: "o1", name: "테크부", active: true, updated_at: "" }, { id: "d2", outlet_id: "o1", name: "구부서", active: false, updated_at: "" }] },
  { id: "o2", name: "헤럴드경제", aliases: [], any_department: true, active: true, updated_at: "2026-09-15T00:00:00Z", departments: [] },
], totals: { outlets: 2, activeOutlets: 2, departments: 2 } };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/media-directory/deliveries")) return { ok: true, json: async () => ({ deliveries: [] }) };
    if (url.startsWith("/api/media-directory/import/preview")) return { ok: true, json: async () => ({ filename: "list.xlsx", rows: [{ outlet: "전자신문", department: "미래부" }], total: 3, blank: 0, duplicates: 2, invalid: [], newOutlets: ["전자신문"], newDepartments: 1, existingPairs: 0, anyDepartmentOutlets: [] }) };
    if (url === "/api/media-directory/import") return { ok: true, json: async () => ({ outletsAdded: 1, outletsExisting: 0, departmentsAdded: 1, departmentsExisting: 0, anyDepartmentSet: 0, skipped: 0 }) };
    if (url === "/api/media-directory/departments") return { ok: true, json: async () => ({ department: { id: "d3", outlet_id: "o1", name: "산업부", active: true, updated_at: "" } }) };
    if (url.startsWith("/api/media-directory/departments?id=")) return { ok: true, json: async () => ({ department: { id: "d2" } }) };
    if (url.startsWith("/api/media-directory?")) return { ok: true, json: async () => directory };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); role.isAdmin = false; });

it("lists outlets with departments, aliases and any-department badge; hides admin controls for users", async () => {
  render(<MediaDirectory />);
  const row = await screen.findByRole("row", { name: /조선일보/ });
  expect(within(row).getByText("테크부")).toBeInTheDocument();
  expect(within(row).getByText("구부서")).toHaveClass("line-through");
  expect(within(row).getByText("별칭: 조선")).toBeInTheDocument();
  expect(within(screen.getByRole("row", { name: /헤럴드경제/ })).getByText("부서 무관")).toBeInTheDocument();
  expect(screen.getByText("매체 2 · 부서 2")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "엑셀 업로드" })).toBeNull();
  expect(screen.queryByRole("button", { name: "매체 추가" })).toBeNull();
});

it("shows admin controls and opens the outlet editor with existing values", async () => {
  role.isAdmin = true;
  render(<MediaDirectory />);
  await screen.findByRole("row", { name: /조선일보/ });
  expect(screen.getByRole("button", { name: "엑셀 업로드" })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("row", { name: /조선일보/ })).getByRole("button", { name: "수정" }));
  expect(await screen.findByDisplayValue("조선일보")).toBeInTheDocument();
  expect(screen.getByDisplayValue("조선")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("부서 추가"), { target: { value: "산업부" } });
  fireEvent.click(screen.getByRole("button", { name: "부서 저장" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media-directory/departments", expect.objectContaining({ method: "POST" })));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === "/api/media-directory/departments")?.[1]?.body))).toEqual({ id: null, outletId: "o1", name: "산업부", active: true });
});

it("previews an upload and applies only the deduplicated rows", async () => {
  const done = vi.fn();
  render(<ImportDialog open onClose={() => {}} onImported={done} />);
  const input = screen.getByLabelText("미디어 리스트 xlsx") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "list.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "미리보기" }));
  await screen.findByText("신규 매체 1 · 신규 부서 1 · 이미 있음 0 · 중복 행 2");
  fireEvent.click(screen.getByRole("button", { name: "1행 적용" }));
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(JSON.parse(String(fetchMock.mock.calls.find(([u]) => u === "/api/media-directory/import")?.[1]?.body))).toEqual({ rows: [{ outlet: "전자신문", department: "미래부" }] });
  expect(await screen.findByText(/매체 1개, 부서 1개를 추가했습니다/)).toBeInTheDocument();
});

it("deletes a department after confirmation and removes it from the list", async () => {
  role.isAdmin = true;
  const confirmMock = vi.fn(() => true);
  vi.stubGlobal("confirm", confirmMock);
  render(<MediaDirectory />);
  await screen.findByRole("row", { name: /조선일보/ });
  fireEvent.click(within(screen.getByRole("row", { name: /조선일보/ })).getByRole("button", { name: "수정" }));
  await screen.findByDisplayValue("조선일보");
  fireEvent.click(screen.getByRole("button", { name: "구부서 삭제" }));
  expect(confirmMock).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/media-directory/departments?id=d2", expect.objectContaining({ method: "DELETE" })));
  await screen.findByText("부서 ‘구부서’을 삭제했습니다.");
  expect(screen.queryByDisplayValue("구부서")).toBeNull();
  confirmMock.mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "테크부 삭제" }));
  expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("id=d1"))).toHaveLength(0);
});
