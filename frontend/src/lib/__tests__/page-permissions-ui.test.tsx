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
it("keeps administrator switches disabled except the default-denied marketing page", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ users: [{ ...user, role: "admin" }] }) }).mockResolvedValue({ ok: true, json: async () => ({ access: { ...user, role: "admin", permissions: { marketing: true }, version: 1 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<PagePermissionsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /테스트 사용자/ }));
  for (const toggle of screen.getAllByRole("switch")) {
    if (toggle.id === "access-marketing") expect(toggle).toBeEnabled(); else expect(toggle).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "변경사항 저장" })).toBeDisabled();
  fireEvent.click(screen.getByRole("switch", { name: "마케팅 Master DB" }));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ userId: user.user_id, permissions: { marketing: true }, version: 0 });
});
it("shows marketing as denied by default for users and grants it with an explicit permission", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ users: [user, { ...user, user_id: "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee", display_name: "지정 검수자", email: "reviewer@example.test" }], designated: { marketing: ["bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"] } }) }).mockResolvedValue({ ok: true, json: async () => ({ access: { ...user, permissions: { marketing: true }, version: 1 } }) });
  vi.stubGlobal("fetch", fetcher);
  render(<PagePermissionsPage />);
  fireEvent.click(await screen.findByRole("button", { name: /테스트 사용자/ }));
  const marketing = screen.getByRole("switch", { name: "마케팅 Master DB" });
  expect(marketing).not.toBeChecked();
  expect(screen.getByText("기본 차단 · 허용하면 조회·Contact 제출")).toBeInTheDocument();
  fireEvent.click(marketing);
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ userId: user.user_id, permissions: { marketing: true }, version: 0 });
  await screen.findByText(/님의 페이지 접근 권한을 저장했습니다/);
  fireEvent.click(screen.getByRole("button", { name: /지정 검수자/ }));
  expect(await screen.findByText("지정 계정·검수자로 접근 중 (이 설정과 무관)")).toBeInTheDocument();
  expect(screen.getByText("허용(지정)")).toBeInTheDocument();
});
