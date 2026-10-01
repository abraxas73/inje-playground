import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authChanged: (_event: string, _session?: { user: { id: string } }) => {} }));
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { onAuthStateChange: (cb: (event: string, session?: { user: { id: string } }) => void) => { m.authChanged = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
import { useUserRole } from "@/hooks/useUserRole";
afterEach(() => { vi.unstubAllGlobals(); });
it("shares permissions and refreshes after admin changes", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ role: "user", permissions: { food: false } }) });
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useUserRole());
  expect(hook.result.current.canAccessPage("/food")).toBe(false);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.canAccessPage("/food")).toBe(false);
  expect(hook.result.current.canAccessPage("/rfp")).toBe(true);
  fetcher.mockResolvedValue({ ok: true, json: async () => ({ role: "user", permissions: { rfp: false } }) });
  act(() => window.dispatchEvent(new Event("page-access-updated")));
  await waitFor(() => expect(hook.result.current.canAccessPage("/rfp")).toBe(false));
  hook.unmount();
});
it("clears prior administrator state as soon as the account changes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ role: "admin", permissions: {} }) }).mockResolvedValue({ ok: true, json: async () => ({ role: "guest", permissions: {} }) }));
  const hook = renderHook(() => useUserRole());
  await waitFor(() => expect(hook.result.current.isAdmin).toBe(true));
  act(() => m.authChanged("SIGNED_OUT"));
  expect(hook.result.current.isAdmin).toBe(false);
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.canAccessPage("/admin")).toBe(false);
  hook.unmount();
});
it("shows no authorized pages when the permission service fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "offline" }) }));
  const hook = renderHook(() => useUserRole());
  await waitFor(() => expect(hook.result.current.error).toBe(true));
  expect(hook.result.current.canAccessPage("/food")).toBe(false);
  expect(hook.result.current.isAdmin).toBe(false);
  hook.unmount();
});

it("keeps the same snapshot across periodic polling and focus when permissions are unchanged", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ userId: "u1", role: "admin", permissions: { rfp: true } }) }));
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useUserRole());
  try {
    await act(async () => {});
    const before = hook.result.current;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(hook.result.current).toBe(before);
  } finally { hook.unmount(); vi.useRealTimers(); }
});
it("same-user session confirmation keeps the screen mounted while refreshing permissions", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: "u1", role: "admin", permissions: {} }) });
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useUserRole());
  await waitFor(() => expect(hook.result.current.isAdmin).toBe(true));
  const before = hook.result.current;
  let finish!: (value: unknown) => void;
  fetcher.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await act(async () => m.authChanged("SIGNED_IN", { user: { id: "u1" } }));
  expect(hook.result.current).toBe(before);
  await act(async () => finish({ ok: true, json: async () => ({ userId: "u1", role: "user", permissions: { rfp: false } }) }));
  expect(hook.result.current.isAdmin).toBe(false);
  expect(hook.result.current.canAccessPage("/rfp")).toBe(false);
  hook.unmount();
});
it("a different signed-in account immediately clears old privileges", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ userId: "u1", role: "admin", permissions: {} }) });
  vi.stubGlobal("fetch", fetcher);
  const hook = renderHook(() => useUserRole());
  await waitFor(() => expect(hook.result.current.isAdmin).toBe(true));
  fetcher.mockReturnValue(new Promise(() => {}));
  act(() => m.authChanged("SIGNED_IN", { user: { id: "u2" } }));
  expect(hook.result.current.loading).toBe(true);
  expect(hook.result.current.isAdmin).toBe(false);
  hook.unmount();
});
