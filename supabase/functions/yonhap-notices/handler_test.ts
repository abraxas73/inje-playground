import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function fixture(options: { role?: string; cooldown?: boolean; invalidToken?: boolean; failSave?: boolean; failCollect?: boolean; secret?: string; denied?: boolean; accessError?: boolean; existingIds?: string[]; alertsThrow?: boolean; obituary?: boolean } = {}) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const alertCalls: { runId: number; sourceIds: string[] }[] = [];
  let collected = 0;
  const db = createClient("https://test.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (path === "/auth/v1/user") return Response.json(options.invalidToken ? { message: "invalid token" } : { id: "user-1" }, { status: options.invalidToken ? 401 : 200 });
      if (path.endsWith("user_profiles")) return Response.json({ role: options.role ?? "user" });
      if (path.endsWith("user_page_access")) return Response.json(options.accessError ? { message: "offline" } : { permissions: { people_news: !options.denied } }, { status: options.accessError ? 500 : 200 });
      if (path.endsWith("claim_yonhap_notice_manual_sync")) return Response.json(!options.cooldown);
      if (path.endsWith("yonhap_notices") && method === "GET") return Response.json((options.existingIds ?? []).map((source_id) => ({ source_id })));
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      writes.push({ path, method, body });
      if (path.endsWith("yonhap_notice_sync_runs") && method === "POST") return Response.json({ id: 1 });
      if (options.failSave && path.endsWith("yonhap_notices")) return Response.json({ message: "db unavailable" }, { status: 500 });
      return new Response(null, { status: 204 });
    } },
  });
  return {
    writes, alertCalls,
    collected: () => collected,
    handler: createHandler({
      secret: options.secret ?? "cron-secret",
      createAdmin: () => db,
      smtp: null,
      appUrl: "https://app.test",
      alerts: async ({ runId, sourceIds }) => {
        alertCalls.push({ runId, sourceIds });
        if (options.alertsThrow) throw new Error("smtp down for sender@example.test");
        return { matches: sourceIds.length, recipients: 0, sent: 0, failed: 0, skipped: sourceIds.length ? "no-recipients" : "no-new-notices" };
      },
      collect: async () => {
        collected++;
        if (options.failCollect) throw new Error("RSS HTTP 503");
        const personnel = { source_id: "AKR20260911000100001", category: "personnel" as const, title: "[인사] 기관", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260911000100001", published_at: "2026-09-10T22:00:00Z" };
        if (!options.obituary) return [personnel];
        return [personnel,
          { source_id: "AKR20260915000200001", category: "obituary" as const, title: "[부고] 새 부고", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260915000200001", published_at: "2026-09-15T00:00:00Z" },
          { source_id: "AKR20260915000200002", category: "obituary" as const, title: "[부고] 기존 부고", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260915000200002", published_at: "2026-09-14T00:00:00Z" }];
      },
    }),
  };
}
const request = (token?: string, method = "POST") => new Request("https://test/yonhap-notices", { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

for (const [name, options, token, status] of [
  ["missing credentials", {}, undefined, 401],
  ["invalid JWT", { invalidToken: true }, "bad-token", 401],
  ["guest", { role: "guest" }, "jwt", 403],
  ["restricted page", { denied: true }, "jwt", 403],
  ["permission lookup error", { accessError: true }, "jwt", 503],
  ["manual cooldown", { cooldown: true }, "jwt", 429],
] as const) {
  Deno.test(`blocks ${name} without collecting or saving`, async () => {
    const f = fixture(options);
    const response = await f.handler(request(token));
    assert(response.status === status, `unexpected status ${response.status}`);
    assert(f.collected() === 0 && f.writes.length === 0);
  });
}

Deno.test("rejects non-POST and missing cron configuration", async () => {
  const f = fixture();
  assert((await f.handler(request("cron-secret", "GET"))).status === 405);
  assert((await fixture({ secret: "" }).handler(request("cron-secret"))).status === 503);
});

for (const token of ["cron-secret", "user-jwt"]) {
  Deno.test(`${token} can collect, upsert and finish a run`, async () => {
    const f = fixture({ cooldown: token === "cron-secret" });
    const response = await f.handler(request(token));
    assert(response.status === 200);
    assert((await response.json()).count === 1);
    assert(f.collected() === 1 && f.writes.length === 3);
    assert((f.writes[0].body as { trigger_source: string }).trigger_source === (token === "cron-secret" ? "cron" : "manual"));
    assert((f.writes[2].body as { status: string }).status === "success");
  });
}

for (const failure of ["failCollect", "failSave"] as const) {
  Deno.test(`${failure} records failure without deleting existing data`, async () => {
    const f = fixture({ [failure]: true });
    assert((await f.handler(request("cron-secret"))).status === 500);
    assert((f.writes.at(-1)?.body as { status: string }).status === "failed");
    assert(!f.writes.some((w) => w.method === "DELETE"));
  });
}

Deno.test("passes only newly stored obituaries to the alert runner", async () => {
  const f = fixture({ obituary: true, existingIds: ["AKR20260915000200002"] });
  const response = await f.handler(request("cron-secret"));
  assert(response.status === 200);
  const body = await response.json();
  assert(f.alertCalls.length === 1 && f.alertCalls[0].runId === 1, "alerts called once with run id");
  assert(f.alertCalls[0].sourceIds.length === 1 && f.alertCalls[0].sourceIds[0] === "AKR20260915000200001", "existing obituary excluded, personnel excluded");
  assert(body.alerts.matches === 1 && body.alerts.skipped === "no-recipients");
});

Deno.test("alert failure never fails the collection run", async () => {
  const f = fixture({ obituary: true, alertsThrow: true });
  const response = await f.handler(request("cron-secret"));
  assert(response.status === 200);
  const body = await response.json();
  assert(body.ok === true && body.count === 3 && body.alerts.error === "media-alerts-failed");
  assert((f.writes.at(-1)?.body as { status: string }).status === "success", "run stays successful");
});

Deno.test("alerts run after the success record and not when saving failed", async () => {
  const f = fixture({ obituary: true, failSave: true });
  assert((await f.handler(request("cron-secret"))).status === 500);
  assert(f.alertCalls.length === 0);
});
