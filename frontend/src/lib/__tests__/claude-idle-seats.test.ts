import { describe, expect, it } from "vitest";
import { minusDays, pickIdleSeats } from "@/lib/claude-usage/idle-seats";

describe("pickIdleSeats — 7일 미사용 자동 해제 대상", () => {
  const base = {
    periodEnd: "2026-11-11", // 7일 = 11-05 ~ 11-11
    members: [
      { email: "idle@x", role: "User", seat_tier: "Standard" },
      { email: "never@x", role: "User", seat_tier: "Premium" },
      { email: "recent@x", role: "User", seat_tier: "Standard" },   // 11-05 활동 → 제외
      { email: "code@x", role: "User", seat_tier: "Standard" },     // CSV는 0이지만 Claude Code 활동
      { email: "new@x", role: "User", seat_tier: "Standard" },      // 7일 전 CSV에 없음(신규)
      { email: "owner@x", role: "Primary Owner", seat_tier: "Premium" },
      { email: "noseat@x", role: "User", seat_tier: "Unassigned" },
      { email: "assigned@x", role: "User", seat_tier: "Standard" }, // 7일 안 시트 할당
      { email: "nocsv@x", role: "User", seat_tier: "Standard" },    // 오늘 CSV에 행 없음 → 판단 보류
    ],
    lastActive: new Map<string, string | null>([
      ["idle@x", "2026-11-04"], ["never@x", null], ["recent@x", "2026-11-05"], ["code@x", "2026-10-01"],
      ["new@x", null], ["owner@x", null], ["noseat@x", null], ["assigned@x", null],
    ]),
    tenured: new Set(["idle@x", "never@x", "recent@x", "code@x", "owner@x", "noseat@x", "assigned@x", "nocsv@x"]),
    codeActive: new Set(["code@x"]),
    recentlyAssigned: new Set(["assigned@x"]),
  };

  it("CSV·Claude Code 모두 7일 사용 0이고, 7일 넘게 있었고, 소유자가 아닌 시트 보유자만", () => {
    expect(pickIdleSeats(base)).toEqual(["idle@x", "never@x"]);
  });

  it("minusDays는 달을 넘긴다", () => {
    expect(minusDays("2026-11-03", 6)).toBe("2026-10-28");
  });
});

describe("sendIdleReleaseNotice — 운영자 계정으로 1:1 채팅을 열어 안내", () => {
  it("me → 1:1 채팅 만들기(나·대상) → 메시지", async () => {
    const { sendIdleReleaseNotice } = await import("@/lib/claude-usage/seat-notice");
    const calls: { url: string; body?: string }[] = [];
    const fake = async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body as string | undefined });
      const j = url.endsWith("/me?$select=id") ? { id: "me-1" } : url.endsWith("/chats") ? { id: "19:abc" } : { id: "m1", createdDateTime: "2026-11-12T00:00:00Z", body: { content: "x" } };
      return new Response(JSON.stringify(j), { status: 201, headers: { "Content-Type": "application/json" } });
    };
    await sendIdleReleaseNotice("t", "a@innogrid.com", "Innogrid_S1", fake);
    expect(calls.map((c) => c.url.replace("https://graph.microsoft.com/v1.0", ""))).toEqual(["/me?$select=id", "/chats", "/chats/19%3Aabc/messages"]);
    const chat = JSON.parse(calls[1].body!);
    expect(chat.chatType).toBe("oneOnOne");
    expect(chat.members.map((m: Record<string, string>) => m["user@odata.bind"])).toEqual(["https://graph.microsoft.com/v1.0/users('me-1')", "https://graph.microsoft.com/v1.0/users('a@innogrid.com')"]);
    expect(JSON.parse(calls[2].body!).body.content).toContain('"Innogrid_S1"');
  });
});
