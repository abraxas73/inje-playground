import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviderSettings } from "@/hooks/useProviderSettings";

afterEach(() => vi.unstubAllGlobals());

describe("useProviderSettings", () => {
  it("settings의 provider 키를 파싱하고 isLoaded를 올린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notify_provider: "teams", dm_provider: "" }) }));
    const { result } = renderHook(() => useProviderSettings());
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.notify).toBe("dooray");

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.notify).toBe("teams");
    expect(result.current.memberSource).toBe("dooray");
    expect(result.current.dm).toBe("dooray");
  });

  it("요청 실패 시 기본값(dooray) 유지 + isLoaded true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const { result } = renderHook(() => useProviderSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current).toMatchObject({ notify: "dooray", memberSource: "dooray", dm: "dooray" });
  });
});
