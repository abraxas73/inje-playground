import { createClient } from "@supabase/supabase-js";
import { previewDigest, runScheduledDigests, runSendNow, SENDER_NAME } from "./digest-mail.ts";
import { SmtpError, type SendResult } from "./smtp.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const smtp = { host: "relay.test", port: 465, user: "relay@example.test", pass: "secret" };
const notice = { title: "[부고] 홍길동씨 부친상", summary: "▲ 홍길순씨 별세", source_url: "https://www.yna.co.kr/view/AKR20260915000000001", published_at: "2026-09-15T10:02:49Z" };
const job = (id: string, user: string) => ({ delivery_id: id, recipient_id: user, recipient_email: `${user}@example.test`, period_from: "2026-09-14T23:10:00Z", period_to: "2026-09-15T23:10:00Z" });

function fixture(options: { jobs?: unknown[]; manual?: unknown[] | { code: string }; disabled?: string[]; sendResult?: Partial<SendResult>; sendError?: Error; noNotices?: boolean; window?: { period_from: string; period_to: string } } = {}) {
  const calls: { path: string; method: string; body: unknown; auth: string | null }[] = [];
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); const method = init?.method ?? "GET"; const headers = new Headers(init?.headers);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path: url.pathname, method, body, auth: headers.get("Authorization") });
    if (url.pathname.endsWith("/rpc/claim_yonhap_notice_emails")) return Response.json(options.jobs ?? []);
    if (url.pathname.endsWith("/rpc/claim_yonhap_notice_send_now")) {
      if (options.manual && !Array.isArray(options.manual)) return Response.json({ code: options.manual.code, message: "denied" }, { status: 400 });
      return Response.json(options.manual ?? []);
    }
    if (url.pathname.endsWith("/yonhap_notice_subscriptions")) { const user = url.searchParams.get("user_id")!.replace("eq.", ""); return Response.json({ enabled: !(options.disabled ?? []).includes(user) }); }
    if (url.pathname.endsWith("/rpc/yonhap_notice_digest_window")) return Response.json(options.window ? [options.window] : []);
    if (url.pathname.endsWith("/yonhap_notices")) return options.noNotices
      ? new Response("[]", { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "*/0" } })
      : new Response(JSON.stringify([notice]), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "0-0/13" } });
    if (url.pathname.endsWith("/yonhap_notice_sync_runs")) return Response.json({ finished_at: "2026-09-15T22:00:02Z" });
    if (url.pathname.endsWith("/yonhap_notice_email_deliveries") || url.pathname.endsWith("/yonhap_notice_manual_deliveries")) return new Response(null, { status: 204 });
    return Response.json({ message: `unexpected ${url.pathname}` }, { status: 500 });
  };
  const client = (key: string, jwt?: string) => createClient("https://test.supabase.co", key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetcher, headers: jwt ? { Authorization: `Bearer ${jwt}` } : {} } });
  const admin = client("service-key");
  const sends: { to: string[]; from: { name?: string; address: string }; subject: string }[] = [];
  const send = async (_config: typeof smtp, message: { to: string[]; from: { name?: string; address: string }; subject: string }) => {
    sends.push(message);
    if (options.sendError) throw options.sendError;
    return { accepted: message.to, rejected: [], messageId: "mid@example.test", ...options.sendResult } as SendResult;
  };
  const patches = (table: string) => calls.filter((c) => c.method === "PATCH" && c.path.endsWith(`/${table}`)).map((c) => c.body as Record<string, unknown>);
  const now = () => new Date("2026-09-15T23:49:22Z");
  return {
    calls, sends, patches,
    scheduled: (over: Record<string, unknown> = {}) => runScheduledDigests({ admin, smtp, appUrl: "https://app.test", send: send as never, now, ...over }),
    sendNow: (over: Record<string, unknown> = {}) => runSendNow({ admin, smtp, appUrl: "https://app.test", send: send as never, now, user: { client: client("anon-key", "user-jwt"), id: "u1", email: "u1@example.test", emailConfirmed: true }, ...over }),
    preview: (over: Record<string, unknown> = {}) => previewDigest({ admin, appUrl: "https://app.test", now, ...over }),
  };
}

Deno.test("scheduled: without SMTP nothing is claimed", async () => {
  const f = fixture({ jobs: [job("d1", "u1")] });
  const summary = await f.scheduled({ smtp: null });
  assert(summary.skipped === "smtp-unconfigured" && f.calls.length === 0 && f.sends.length === 0);
});
Deno.test("scheduled: sends enabled subscriptions, cancels disabled ones, records results", async () => {
  const f = fixture({ jobs: [job("d1", "u1"), job("d2", "u2")], disabled: ["u2"] });
  const summary = await f.scheduled();
  assert(summary.claimed === 2 && summary.sent === 1 && summary.cancelled === 1 && summary.failed === 0, JSON.stringify(summary));
  assert(f.sends.length === 1 && f.sends[0].to[0] === "u1@example.test" && f.sends[0].from.address === smtp.user && f.sends[0].from.name === SENDER_NAME);
  assert(f.sends[0].subject === "[인사·부고] 2026. 9. 16. 새 소식 13건", f.sends[0].subject);
  const claim = f.calls.find((c) => c.path.endsWith("claim_yonhap_notice_emails"))!;
  assert((claim.body as { p_limit: number }).p_limit === 10);
  const patches = f.patches("yonhap_notice_email_deliveries");
  assert(patches.length === 2);
  assert(patches[0].status === "sent" && patches[0].provider_id === "mid@example.test" && patches[0].item_count === 13 && patches[0].finished_at === "2026-09-15T23:49:22.000Z");
  assert(patches[1].status === "cancelled" && !("item_count" in patches[1]));
});
Deno.test("scheduled: SMTP failure marks the delivery failed with a sanitized message and continues", async () => {
  const f = fixture({ jobs: [job("d1", "u1"), job("d2", "u2")], sendError: new SmtpError("auth", 535, "bad credentials for relay@example.test") });
  const summary = await f.scheduled();
  assert(summary.sent === 0 && summary.failed === 2 && f.sends.length === 2);
  const patches = f.patches("yonhap_notice_email_deliveries");
  assert(patches.every((p) => p.status === "failed" && String(p.error_message).includes("auth") && !String(p.error_message).includes("relay@example.test")));
});
Deno.test("scheduled: a rejected recipient is a failure", async () => {
  const f = fixture({ jobs: [job("d1", "u1")], sendResult: { accepted: [], rejected: [{ address: "u1@example.test", code: 550 }] } });
  const summary = await f.scheduled();
  assert(summary.failed === 1 && f.patches("yonhap_notice_email_deliveries")[0].status === "failed" && String(f.patches("yonhap_notice_email_deliveries")[0].error_message).includes("550"));
});

Deno.test("send-now: unverified email is refused before any claim", async () => {
  const f = fixture();
  const result = await f.sendNow({ user: { client: null, id: "u1", email: "u1@example.test", emailConfirmed: false } });
  assert(result.status === 400 && f.calls.length === 0);
});
Deno.test("send-now: SMTP unconfigured is refused before the claim so the cooldown is untouched", async () => {
  const f = fixture();
  const result = await f.sendNow({ smtp: null });
  assert(result.status === 503 && f.calls.length === 0);
});
Deno.test("send-now: cooldown yields 429 with Retry-After", async () => {
  const f = fixture({ manual: [] });
  const result = await f.sendNow();
  assert(result.status === 429 && result.headers?.["Retry-After"] === "60" && f.sends.length === 0);
  const claim = f.calls.find((c) => c.path.endsWith("claim_yonhap_notice_send_now"))!;
  assert(claim.auth === "Bearer user-jwt", "claim runs with the user's session");
});
Deno.test("send-now: permission and verification errors from the RPC map to 403/400", async () => {
  assert((await fixture({ manual: { code: "42501" } }).sendNow()).status === 403);
  assert((await fixture({ manual: { code: "22023" } }).sendNow()).status === 400);
  assert((await fixture({ manual: { code: "XX000" } }).sendNow()).status === 500);
});
Deno.test("send-now: sends the 24-hour digest to the login email and records the manual delivery", async () => {
  const f = fixture({ manual: [{ delivery_id: "m1", period_from: "2026-09-14T23:49:22Z", period_to: "2026-09-15T23:49:22Z" }] });
  const result = await f.sendNow();
  assert(result.status === 200 && result.body.count === 13 && result.body.from === "2026-09-14T23:49:22Z", JSON.stringify(result));
  assert(f.sends.length === 1 && f.sends[0].to[0] === "u1@example.test");
  const patch = f.patches("yonhap_notice_manual_deliveries")[0];
  assert(patch.status === "sent" && patch.item_count === 13 && patch.provider_id === "mid@example.test");
  assert(f.patches("yonhap_notice_email_deliveries").length === 0, "scheduled deliveries untouched");
});
Deno.test("send-now: SMTP failure records failed and answers 502", async () => {
  const f = fixture({ manual: [{ delivery_id: "m1", period_from: "2026-09-14T23:49:22Z", period_to: "2026-09-15T23:49:22Z" }], sendError: new Error("connect ECONNREFUSED relay@example.test") });
  const result = await f.sendNow();
  assert(result.status === 502);
  const patch = f.patches("yonhap_notice_manual_deliveries")[0];
  assert(patch.status === "failed" && !String(patch.error_message).includes("relay@example.test"));
});

Deno.test("preview: last 24 hours, read-only", async () => {
  const f = fixture();
  const body = await f.preview();
  assert(body.count === 13 && body.to === "2026-09-15T23:49:22.000Z" && body.from === "2026-09-14T23:49:22.000Z" && typeof body.html === "string");
  assert(f.sends.length === 0 && f.calls.every((c) => c.method === "GET"));
});

const manualJob = (excluded: boolean) => [{ delivery_id: "m1", period_from: "2026-09-15T22:10:00Z", period_to: "2026-09-15T23:49:22Z", excluded }];

Deno.test("send-now: 이전 발송 내역 제외 값을 claim RPC로 그대로 넘긴다", async () => {
  for (const value of [true, false, null]) {
    const f = fixture({ manual: manualJob(value === true) });
    await f.sendNow({ excludeSent: value });
    const claim = f.calls.find((c) => c.path.endsWith("claim_yonhap_notice_send_now"))!;
    assert((claim.body as { p_exclude_sent: boolean | null }).p_exclude_sent === value, `expected ${value}`);
  }
});

Deno.test("send-now: 제외 옵션에서 보낼 것이 없으면 메일을 만들지 않고 skipped로 기록한다", async () => {
  const f = fixture({ manual: manualJob(true), noNotices: true });
  const result = await f.sendNow();
  assert(result.status === 200 && result.body.count === 0 && result.body.skipped === true, JSON.stringify(result));
  assert(f.sends.length === 0, "메일을 보내지 않는다");
  const patch = f.patches("yonhap_notice_manual_deliveries")[0];
  assert(patch.status === "skipped" && patch.item_count === 0 && patch.finished_at === "2026-09-15T23:49:22.000Z", JSON.stringify(patch));
});

Deno.test("send-now: 제외 옵션이 아니면 0건이어도 예전처럼 보낸다", async () => {
  const f = fixture({ manual: manualJob(false), noNotices: true });
  const result = await f.sendNow();
  assert(result.status === 200 && result.body.count === 0 && !result.body.skipped);
  assert(f.sends.length === 1 && f.patches("yonhap_notice_manual_deliveries")[0].status === "sent");
});

Deno.test("preview: 사용자 구간 RPC 결과를 쓰고, 실패하면 최근 24시간으로 되돌린다", async () => {
  const withWindow = fixture({ window: { period_from: "2026-09-15T22:10:00Z", period_to: "2026-09-15T23:49:22Z" } });
  const body = await withWindow.preview({ userId: "u1", excludeSent: true });
  assert(body.from === "2026-09-15T22:10:00.000Z" && body.to === "2026-09-15T23:49:22.000Z", JSON.stringify(body));
  const rpc = withWindow.calls.find((c) => c.path.endsWith("yonhap_notice_digest_window"))!;
  assert((rpc.body as { p_user: string; p_exclude_sent: boolean }).p_user === "u1" && (rpc.body as { p_exclude_sent: boolean }).p_exclude_sent === true);
  const noWindow = fixture();
  const fallback = await noWindow.preview({ userId: "u1" });
  assert(fallback.from === "2026-09-14T23:49:22.000Z" && fallback.to === "2026-09-15T23:49:22.000Z", JSON.stringify(fallback));
  const anonymous = await fixture().preview();
  assert(anonymous.from === "2026-09-14T23:49:22.000Z");
});
