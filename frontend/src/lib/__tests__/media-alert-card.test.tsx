import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MediaAlertCard from "@/components/people-news/MediaAlertCard";

afterEach(() => vi.unstubAllGlobals());
const settings = (over: Record<string, unknown> = {}) => ({ email: "me@innogrid.com", emailVerified: true, enabled: false, updatedAt: null, latestDelivery: null, ...over });

it("shows the login email, toggles through PUT and reports the saved state", async () => {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => init?.method === "PUT" ? { enabled: true, updatedAt: "2026-09-15T01:00:00Z" } : settings() }));
  vi.stubGlobal("fetch", fetchMock);
  render(<MediaAlertCard />);
  expect(await screen.findByText(/me@innogrid.com/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("switch", { name: "관리 매체·부서 부고 알림 받기" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/people-news/media-alerts", expect.objectContaining({ method: "PUT" })));
  expect(JSON.parse(String(fetchMock.mock.calls.find(([, o]) => o?.method === "PUT")?.[1]?.body))).toEqual({ enabled: true });
  expect(await screen.findByText("알림을 켰습니다. 새 부고가 관리 매체·부서와 일치하면 메일을 보냅니다.")).toBeInTheDocument();
});

it("disables the switch for unverified email and shows the latest failure", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => settings({ emailVerified: false, enabled: false, latestDelivery: { status: "failed", created_at: "2026-09-15T00:00:00Z", match_count: 2, error_message: "SMTP auth 실패 (535)" } }) })));
  render(<MediaAlertCard />);
  expect(await screen.findByRole("switch", { name: "관리 매체·부서 부고 알림 받기" })).toBeDisabled();
  expect(screen.getByText(/계정 이메일 인증이 필요합니다/)).toBeInTheDocument();
  expect(screen.getByText(/최근 알림 발송 실패/)).toBeInTheDocument();
});
