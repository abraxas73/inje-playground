import { describe, it, expect, vi } from "vitest";
import { createNotifier, getNotifier, NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { loadSettings, loadUserSettings } from "@/lib/settings-server";

/** supabase.from(table).select(cols).in(col, vals) / .eq(col,val).in(col, vals) 체인 흉내 */
function fakeSupabase(rowsByTable: Record<string, { key: string; value: string }[]>) {
  const calls: { table: string; keys: string[]; eq?: [string, string] }[] = [];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { table, keys: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        eq(col: string, val: string) { call.eq = [col, val]; return builder; },
        in(_col: string, vals: string[]) {
          call.keys = vals;
          return Promise.resolve({ data: (rowsByTable[table] ?? []).filter((r) => vals.includes(r.key)), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe("createNotifier", () => {
  it("기본(키 없음)은 Dooray, 설정값으로 configured 플래그 결정", () => {
    const n = createNotifier("notify", { dooray_hook_url: "https://hook", dooray_token: "" });
    expect(n.provider).toBe("dooray");
    expect(n.channelConfigured).toBe(true);
    expect(n.directConfigured).toBe(false);
  });

  it("축별로 독립 선택 — notify=teams, dm=dooray", () => {
    const s = { notify_provider: "teams", dm_provider: "dooray", teams_notify_webhook_url: "https://w", dooray_token: "t" };
    expect(createNotifier("notify", s).provider).toBe("teams");
    expect(createNotifier("notify", s).channelConfigured).toBe(true);
    expect(createNotifier("dm", s).provider).toBe("dooray");
    expect(createNotifier("dm", s).directConfigured).toBe(true);
  });

  it("NOTIFIER_SETTING_KEYS에 필요한 키가 모두 있다", () => {
    expect([...NOTIFIER_SETTING_KEYS].sort()).toEqual(
      ["dm_provider", "dooray_hook_url", "dooray_token", "notify_provider", "teams_dm_webhook_url", "teams_notify_webhook_url"].sort()
    );
  });
});

describe("loadSettings / loadUserSettings", () => {
  it("settings 테이블에서 요청 키만 맵으로", async () => {
    const { client, calls } = fakeSupabase({ settings: [{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "c", value: "3" }] });
    expect(await loadSettings(client, ["a", "c"])).toEqual({ a: "1", c: "3" });
    expect(calls[0]).toMatchObject({ table: "settings", keys: ["a", "c"] });
  });

  it("user_settings는 user_id로 필터", async () => {
    const { client, calls } = fakeSupabase({ user_settings: [{ key: "dooray_token", value: "ut" }] });
    expect(await loadUserSettings(client, "u1", ["dooray_token"])).toEqual({ dooray_token: "ut" });
    expect(calls[0]).toMatchObject({ table: "user_settings", eq: ["user_id", "u1"], keys: ["dooray_token"] });
  });
});

describe("getNotifier", () => {
  it("settings를 읽고 truthy override만 덮어쓴다", async () => {
    const { client } = fakeSupabase({
      settings: [
        { key: "dm_provider", value: "dooray" },
        { key: "dooray_token", value: "system-token" },
      ],
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const n = await getNotifier(client, "dm", { dooray_token: "user-token" });
      await n.sendDirect({ memberId: "m" }, { text: "x" });
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("dooray-api user-token");

      const n2 = await getNotifier(client, "dm", { dooray_token: "" });
      await n2.sendDirect({ memberId: "m" }, { text: "x" });
      expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("dooray-api system-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
