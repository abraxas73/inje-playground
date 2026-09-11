import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PagePermissionsPage from "@/app/admin/page-permissions/page";
const user = { user_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", display_name: "테스트 사용자", email: "member@example.test", role: "user", permissions: {}, version: 0 };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("stages changes and saves only the selected user", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ users: [user] }) }).mockResolvedValue({ ok: true, json: async () => ({ access: { ...user, permissions: { food: false }, version: 1 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<PagePermissionsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /테스트 사용자/ }));
  fireEvent.click(screen.getByRole("switch", { name: "뭐 먹지" }));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(screen.getByText("1개 변경 · 저장 필요")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ userId: user.user_id, permissions: { food: false }, version: 0 });
  await screen.findByText(/님의 페이지 접근 권한을 저장했습니다/);
});
it("keeps administrator switches disabled", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [{ ...user, role: "admin" }] }) }));
  render(<PagePermissionsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /테스트 사용자/ }));
  for (const toggle of screen.getAllByRole("switch")) expect(toggle).toBeDisabled();
  expect(screen.getByRole("button", { name: "변경사항 저장" })).toBeDisabled();
});
