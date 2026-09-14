import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ExcelUpload from "@/components/marketing/ExcelUpload";
import { emptyContact } from "@/lib/marketing/types";
afterEach(() => vi.unstubAllGlobals());
it("retains successful rows and retries only edited failed rows", async () => {
  const preview = { filename: "contacts.xlsx", hash: "hash", total: 2, sheet: "Contact 제출", headerRow: 1, errors: [], columns: ["회사명"], rows: [2,3].map(row => ({ row, dbId: "", data: { ...emptyContact(), company: "회사", name: `이름${row}`, email: `test${row}@example.com` }, raw: {}, errors: [] })) };
  let submissions = 0;
  const fetch = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("/excel") ? preview : ++submissions === 1 ? { results: [{ index: 0, row: 2, status: "submitted" }, { index: 1, row: 3, status: "error", error: "DB 저장 실패" }] } : { results: [{ index: 0, row: 3, status: "submitted" }] } })); vi.stubGlobal("fetch", fetch);
  const saved = vi.fn(); render(<ExcelUpload master={false} onClose={() => {}} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText("Excel 파일"), { target: { files: [new File(["xlsx"], "contacts.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "파일 미리보기" })); await screen.findByText("이름2");
  fireEvent.click(screen.getByRole("button", { name: "2건 검증 후 제출" })); await screen.findByText("DB 저장 실패");
  expect(screen.queryByRole("button", { name: "2행 수정" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "3행 수정" })); fireEvent.change(screen.getByLabelText("성명"), { target: { value: "수정 이름" } });
  fireEvent.click(screen.getByRole("button", { name: "1건 검증 후 제출" })); await screen.findByText(/제출 완료 2건/);
  const calls = fetch.mock.calls as unknown as [string, RequestInit][];
  const payload = JSON.parse(String(calls.at(-1)![1].body)); expect(payload.rows).toHaveLength(1); expect(payload.rows[0].data.name).toBe("수정 이름");
  fireEvent.click(screen.getByRole("button", { name: "완료 · 검수 목록으로" })); expect(saved).toHaveBeenCalledOnce();
});
it("keeps the preview available after a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("연결 실패")));
  render(<ExcelUpload master={false} onClose={() => {}} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText("Excel 파일"), { target: { files: [new File(["xlsx"], "contacts.xlsx")] } });
  fireEvent.click(screen.getByRole("button", { name: "파일 미리보기" })); expect(await screen.findByRole("alert")).toHaveTextContent("연결 실패");
  await waitFor(() => expect(screen.getByRole("button", { name: "파일 미리보기" })).toBeEnabled());
});
