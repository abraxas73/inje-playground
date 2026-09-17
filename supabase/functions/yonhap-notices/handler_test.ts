import { createClient } from "@supabase/supabase-js";
import { createHandler } from "./handler.ts";

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}

function fixture(options: { role?: string; cooldown?: boolean; invalidToken?: boolean; failSave?: boolean; failCollect?: boolean; secret?: string; denied?: boolean; accessError?: boolean; existingIds?: string[]; alertsThrow?: boolean; obituary?: boolean; storedSummary?: string; enrichThrow?: boolean; headerOnly?: boolean } = {}) {
  const writes: { path: string; method: string; body: unknown }[] = [];
  const alertCalls: { runId: number; sourceIds: string[] }[] = [];
  const enrichCalls: string[][] = [];
  const digestCalls: { kind: string; userId?: string; email?: string | null; userAuth?: string | null; excludeSent?: boolean | null }[] = [];
  let collected = 0;
  const db = createClient("https://test.supabase.co", "service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (path === "/auth/v1/user") return Response.json(options.invalidToken ? { message: "invalid token" } : { id: "user-1", email: "user@example.test", email_confirmed_at: "2026-09-01T00:00:00Z" }, { status: options.invalidToken ? 401 : 200 });
      if (path.endsWith("user_profiles")) return Response.json({ role: options.role ?? "user" });
      if (path.endsWith("user_page_access")) return Response.json(options.accessError ? { message: "offline" } : { permissions: { people_news: !options.denied } }, { status: options.accessError ? 500 : 200 });
      if (path.endsWith("claim_yonhap_notice_manual_sync")) return Response.json(!options.cooldown);
      if (path.endsWith("yonhap_notices") && method === "GET") return Response.json((options.existingIds ?? []).map((source_id) => ({ source_id, summary: options.storedSummary ?? "▲ 이미 보강됨 (서울=연합뉴스)" })));
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      writes.push({ path, method, body });
      if (path.endsWith("yonhap_notice_sync_runs") && method === "POST") return Response.json({ id: 1 });
      if (options.failSave && path.endsWith("yonhap_notices")) return Response.json({ message: "db unavailable" }, { status: 500 });
      return new Response(null, { status: 204 });
    } },
  });
  return {
    writes, alertCalls, digestCalls, enrichCalls,
    collected: () => collected,
    handler: createHandler({
      secret: options.secret ?? "cron-secret",
      createAdmin: () => db,
      createUserClient: (jwt) => ({ jwt } as unknown as ReturnType<typeof createClient>),
      enrich: (notices) => {
        enrichCalls.push(notices.map((n) => n.source_id));
        if (options.enrichThrow) throw new Error("원문 서버 장애");
        return Promise.resolve({ enriched: notices.length, failed: 0 });
      },
      smtp: null,
      appUrl: "https://app.test",
      digests: {
        scheduled: async () => { digestCalls.push({ kind: "scheduled" }); return { claimed: 2, sent: 1, failed: 0, cancelled: 1 }; },
        sendNow: async ({ user, excludeSent }) => { digestCalls.push({ kind: "send-now", userId: user.id, email: user.email, userAuth: (user.client as unknown as { jwt: string }).jwt, excludeSent }); return { status: 429, body: { error: "wait" }, headers: { "Retry-After": "60" } }; },
        preview: async ({ userId, excludeSent }) => { digestCalls.push({ kind: "preview", userId, excludeSent }); return { subject: "s", html: "<p></p>", text: "t", count: 0, from: "a", to: "b" }; },
      },
      alerts: async ({ runId, sourceIds }) => {
        alertCalls.push({ runId, sourceIds });
        if (options.alertsThrow) throw new Error("smtp down for sender@example.test");
        return { matches: sourceIds.length, recipients: 0, sent: 0, failed: 0, skipped: sourceIds.length ? "no-recipients" : "no-new-notices" };
      },
      collect: async () => {
        collected++;
        if (options.failCollect) throw new Error("RSS HTTP 503");
        const personnel = { source_id: "AKR20260911000100001", category: "personnel" as const, title: "[인사] 기관", summary: options.headerOnly ? "◇ 과장급 전보" : "요약", source_url: "https://www.yna.co.kr/view/AKR20260911000100001", published_at: "2026-09-10T22:00:00Z" };
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

const withBody = (token: string, body: string) => new Request("https://test/yonhap-notices", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body });

Deno.test("empty body, {} and action collect all run a collection", async () => {
  for (const body of ["", "{}", '{"action":"collect"}']) {
    const f = fixture();
    const response = await f.handler(withBody("cron-secret", body));
    assert(response.status === 200 && f.collected() === 1, `body ${JSON.stringify(body)} → ${response.status}`);
  }
});

Deno.test("unknown action or broken JSON is rejected before any work", async () => {
  for (const body of ['{"action":"drop"}', "not json"]) {
    const f = fixture();
    assert((await f.handler(withBody("cron-secret", body))).status === 400);
    assert(f.collected() === 0 && f.writes.length === 0 && f.digestCalls.length === 0);
  }
});

Deno.test("send-digests runs only for the scheduler and never collects", async () => {
  const denied = fixture();
  assert((await denied.handler(withBody("user-jwt", '{"action":"send-digests"}'))).status === 403);
  assert(denied.digestCalls.length === 0);
  const f = fixture();
  const response = await f.handler(withBody("cron-secret", '{"action":"send-digests"}'));
  const body = await response.json();
  assert(response.status === 200 && body.ok === true && body.claimed === 2 && body.sent === 1 && body.cancelled === 1, JSON.stringify(body));
  assert(f.digestCalls.length === 1 && f.digestCalls[0].kind === "scheduled");
  assert(f.collected() === 0 && f.writes.length === 0, "no sync run recorded");
});

Deno.test("send-now and preview require a verified user session", async () => {
  for (const action of ["send-now", "preview"]) {
    const cron = fixture();
    assert((await cron.handler(withBody("cron-secret", `{"action":"${action}"}`))).status === 403, `${action} with cron secret`);
    const guest = fixture({ role: "guest" });
    assert((await guest.handler(withBody("user-jwt", `{"action":"${action}"}`))).status === 403, `${action} as guest`);
    const restricted = fixture({ denied: true });
    assert((await restricted.handler(withBody("user-jwt", `{"action":"${action}"}`))).status === 403, `${action} restricted`);
    assert(cron.digestCalls.length === 0 && guest.digestCalls.length === 0 && restricted.digestCalls.length === 0);
  }
});

Deno.test("send-now passes the verified user and their session client, relaying status and Retry-After", async () => {
  const f = fixture();
  const response = await f.handler(withBody("user-jwt", '{"action":"send-now"}'));
  assert(response.status === 429 && response.headers.get("Retry-After") === "60" && response.headers.get("Cache-Control") === "no-store");
  assert(f.digestCalls.length === 1 && f.digestCalls[0].kind === "send-now" && f.digestCalls[0].userId === "user-1" && f.digestCalls[0].email === "user@example.test" && f.digestCalls[0].userAuth === "user-jwt", JSON.stringify(f.digestCalls));
  assert(f.collected() === 0 && f.writes.length === 0);
});

Deno.test("preview returns the digest without collecting or claiming", async () => {
  const f = fixture();
  const response = await f.handler(withBody("user-jwt", '{"action":"preview"}'));
  const body = await response.json();
  assert(response.status === 200 && body.subject === "s" && body.count === 0);
  assert(f.digestCalls[0].kind === "preview" && f.collected() === 0 && f.writes.length === 0);
});

Deno.test("send-now·preview는 본문의 excludeSent를 그대로 전달하고, 없으면 null(저장된 설정)이다", async () => {
  for (const [body, expected] of [['{"action":"send-now","excludeSent":true}', true], ['{"action":"send-now","excludeSent":false}', false], ['{"action":"send-now"}', null]] as const) {
    const f = fixture();
    await f.handler(withBody("user-jwt", body));
    assert(f.digestCalls[0].excludeSent === expected, `${body} → ${f.digestCalls[0].excludeSent}`);
  }
  const p = fixture();
  await p.handler(withBody("user-jwt", '{"action":"preview","excludeSent":true}'));
  assert(p.digestCalls[0].kind === "preview" && p.digestCalls[0].excludeSent === true && p.digestCalls[0].userId === "user-1");
});

Deno.test("새 기사와 아직 기사 끝까지 오지 않은 저장분만 원문 보강 대상으로 넘긴다", async () => {
  const fresh = fixture();
  await fresh.handler(request("cron-secret"));
  assert(fresh.enrichCalls.length === 1 && fresh.enrichCalls[0].length === 1, JSON.stringify(fresh.enrichCalls));

  // 이미 보강된 저장분은 제외
  const done = fixture({ existingIds: ["AKR20260911000100001"] });
  await done.handler(request("cron-secret"));
  assert(done.enrichCalls[0].length === 0, JSON.stringify(done.enrichCalls));

  // 저장된 요약이 여전히 기사 끝까지 오지 않았으면 다시 시도(과거분 보강)
  const retry = fixture({ existingIds: ["AKR20260911000100001"], storedSummary: "◇ 과장급 전보" });
  await retry.handler(request("cron-secret"));
  assert(retry.enrichCalls[0].length === 1, JSON.stringify(retry.enrichCalls));
});

Deno.test("보강 건수를 응답에 담고, 보강이 실패해도 수집은 성공한다", async () => {
  const ok = fixture({ headerOnly: true });
  const body = await (await ok.handler(request("cron-secret"))).json();
  assert(body.enriched === 1, JSON.stringify(body));
  const broken = fixture({ enrichThrow: true });
  const response = await broken.handler(request("cron-secret"));
  const failed = await response.json();
  assert(response.status === 200 && failed.ok === true && failed.enriched === 0, JSON.stringify(failed));
  assert((broken.writes.at(-1)?.body as { status: string }).status === "success");
});

Deno.test("이미 보강된 저장 요약을 더 짧은 RSS 요약으로 되돌리지 않는다", async () => {
  const f = fixture({ headerOnly: true, existingIds: ["AKR20260911000100001"], storedSummary: "◇ 과장급 전보 ▲ 요양보험운영과장 박지혜" });
  await f.handler(request("cron-secret"));
  const upsert = f.writes.find((w) => w.path.endsWith("yonhap_notices") && w.method === "POST")!;
  const saved = (upsert.body as { source_id: string; summary: string }[]).find((n) => n.source_id === "AKR20260911000100001")!;
  assert(saved.summary === "◇ 과장급 전보 ▲ 요양보험운영과장 박지혜", saved.summary);

  // 저장분이 더 짧으면 이번에 보강한 값을 그대로 저장한다
  const retry = fixture({ headerOnly: true, existingIds: ["AKR20260911000100001"], storedSummary: "◇ 과장급 전보" });
  await retry.handler(request("cron-secret"));
  const body = (retry.writes.find((w) => w.path.endsWith("yonhap_notices") && w.method === "POST")!.body as { source_id: string; summary: string }[]);
  assert(body.find((n) => n.source_id === "AKR20260911000100001")!.summary === "◇ 과장급 전보", "enrich 스텁은 내용을 바꾸지 않는다");
});
