import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function fixture(options: { role?: string; cooldown?: boolean; invalidToken?: boolean; failSave?: boolean; failCollect?: boolean; secret?: string } = {}) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  let collected = 0;
  const db = createClient("https://test.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path === "/auth/v1/user") return Response.json(options.invalidToken ? { message: "invalid token" } : { id: "user-1" }, { status: options.invalidToken ? 401 : 200 });
      if (path.endsWith("user_profiles")) return Response.json({ role: options.role ?? "user" });
      if (path.endsWith("claim_yonhap_notice_manual_sync")) return Response.json(!options.cooldown);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      writes.push({ path, method, body });
      if (path.endsWith("yonhap_notice_sync_runs") && method === "POST") return Response.json({ id: 1 });
      if (options.failSave && path.endsWith("yonhap_notices")) return Response.json({ message: "db unavailable" }, { status: 500 });
      return new Response(null, { status: 204 });
    } },
  });
  return {
    writes,
    collected: () => collected,
    handler: createHandler({
      secret: options.secret ?? "cron-secret",
      createAdmin: () => db,
      collect: async () => {
        collected++;
        if (options.failCollect) throw new Error("RSS HTTP 503");
        return [{ source_id: "AKR20260911000100001", category: "personnel", title: "[인사] 기관", summary: "요약", source_url: "https://www.yna.co.kr/view/AKR20260911000100001", published_at: "2026-09-10T22:00:00Z" }];
      },
    }),
  };
}
const request = (token?: string, method = "POST") => new Request("https://test/yonhap-notices", { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });

for (const [name, options, token, status] of [
  ["missing credentials", {}, undefined, 401],
  ["invalid JWT", { invalidToken: true }, "bad-token", 401],
  ["guest", { role: "guest" }, "jwt", 403],
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
