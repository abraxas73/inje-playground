import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase", () => ({ createClient: () => ({ auth: { verifyOtp } }) }));
// Next.js는 window.history.replaceState(조각 제거)를 가로채 라우터를 갱신하고 useSearchParams()가 새 객체를 돌려준다 — 리렌더마다 새 객체로 흉내(페이지는 이제 useSearchParams를 안 쓰지만, 회귀 방지로 남긴다).
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

import { MobileAuth } from "@/app/auth/mobile/page";

describe("/auth/mobile (앱 WebView 부트스트랩)", () => {
  beforeEach(() => {
    verifyOtp.mockReset();
    window.history.replaceState(null, "", "/auth/mobile?next=%2Fsettings");
  });

  it("조각 토큰으로 verifyOtp 1회 → next로 이동. 조각을 지운 뒤 리렌더가 와도(useSearchParams 새 객체) '세션 토큰이 없습니다'로 덮어쓰지 않는다", async () => {
    window.location.hash = "#token=abc";
    verifyOtp.mockResolvedValue({ error: null });
    const navigate = vi.fn();
    const { rerender } = render(<MobileAuth navigate={navigate} />);
    rerender(<MobileAuth navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/settings"));
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "abc", type: "email" });
    expect(screen.queryByText(/세션 토큰이 없습니다/)).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("토큰이 없으면(새로고침·WebView 재로드) 오류 대신 next로 보낸다 — 쿠키 세션이 있으면 그대로 열리고, 없으면 /login으로 가 앱이 다시 부트스트랩한다", async () => {
    window.location.hash = "";
    const navigate = vi.fn();
    render(<MobileAuth navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/settings"));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("verifyOtp 실패는 오류로 보여 준다", async () => {
    window.location.hash = "#token=expired";
    verifyOtp.mockResolvedValue({ error: { message: "Token has expired" } });
    const navigate = vi.fn();
    render(<MobileAuth navigate={navigate} />);
    await waitFor(() => expect(screen.getByText(/세션을 만들지 못했습니다: Token has expired/)).toBeTruthy());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("Microsoft 연결 시작은 앱 복귀 표시를 붙이고 returnTo를 유지한다", async () => {
    window.history.replaceState(null, "", "/auth/mobile?next=" + encodeURIComponent("/api/ms/connect?returnTo=%2Fteams%2Fchat") + "#token=once");
    verifyOtp.mockResolvedValue({ error: null });
    const navigate = vi.fn();
    render(<MobileAuth navigate={navigate} />);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/api/ms/connect?returnTo=%2Fteams%2Fchat&app_return=1"));
    expect(window.location.hash).toBe("");
  });
});
