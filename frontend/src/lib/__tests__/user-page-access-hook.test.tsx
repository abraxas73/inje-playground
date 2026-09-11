import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ authChanged: (_event: string) => {} }));
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { onAuthStateChange: (cb: (event: string) => void) => { m.authChanged = cb; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
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
