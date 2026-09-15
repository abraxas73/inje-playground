import { createClient } from "@supabase/supabase-js";
import { buildAlertDigest, runMediaAlerts, type AlertMatch } from "./alerts.ts";
import { SmtpError, type SendResult } from "./smtp.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const match = (id: number, department: string | null = "테크부"): AlertMatch => ({
  id, sourceId: `AKR2026091500000000${id}`, outlet: "중앙일보", department, matchedText: department ? `중앙일보 / ${department}` : "중앙일보",
  title: `[부고] 홍길동(중앙일보 기자)씨 부친상 <script>`, summary: "▲ 홍길순씨 별세, 홍길동(중앙일보 테크부 기자)씨 부친상 = 15일", url: `https://www.yna.co.kr/view/AKR2026091500000000${id}`, publishedAt: "2026-09-14T23:00:00Z",
});
const recipients = [{ user_id: "u1", email: "a@example.test" }, { user_id: "u2", email: "b@example.test" }];
const smtp = { host: "relay.test", port: 465, user: "sender@example.test", pass: "secret" };

function fixture(options: { matches?: AlertMatch[]; recipients?: typeof recipients; sendResult?: Partial<SendResult>; sendError?: Error; failInsert?: boolean } = {}) {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const admin = createClient("https://test.supabase.co", "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const path = new URL(String(input)).pathname; const method = init?.method ?? "GET"; const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, method, body });
    if (path.endsWith("/rpc/media_match_notices")) return Response.json(options.matches ?? [match(1), match(2, null)]);
    if (path.endsWith("/rpc/media_alert_recipients")) return Response.json(options.recipients ?? recipients);
    if (path.endsWith("/media_alert_deliveries")) return options.failInsert ? Response.json({ message: "down" }, { status: 500 }) : new Response(null, { status: 201 });
    if (path.endsWith("/media_obituary_matches")) return new Response(null, { status: 204 });
    return Response.json({ message: `unexpected ${path}` }, { status: 500 });
  } } });
  const sends: unknown[] = [];
  const send = async (_config: typeof smtp, message: { to: string[] }) => {
    sends.push(message);
    if (options.sendError) throw options.sendError;
    return { accepted: message.to, rejected: [], messageId: "m@example.test", ...options.sendResult } as SendResult;
  };
  return { calls, sends, run: (over: Partial<Parameters<typeof runMediaAlerts>[0]> = {}) => runMediaAlerts({ admin, runId: 7, sourceIds: ["AKR20260915000000001", "AKR20260915000000002"], smtp, appUrl: "https://app.test", send: send as never, now: () => new Date("2026-09-15T00:30:00Z"), ...over }) };
}

Deno.test("does nothing without new notices", async () => {
  const f = fixture(); const summary = await f.run({ sourceIds: [] });
  assert(summary.skipped === "no-new-notices" && f.calls.length === 0 && f.sends.length === 0);
});
Deno.test("stops after matching when nothing matched", async () => {
  const f = fixture({ matches: [] }); const summary = await f.run();
  assert(summary.skipped === "no-matches" && summary.matches === 0 && f.calls.length === 1 && f.sends.length === 0);
  const body = f.calls[0].body as { p_source_ids: string[]; p_run_id: number };
  assert(body.p_source_ids.length === 2 && body.p_run_id === 7);
});
Deno.test("keeps matches but skips sending when SMTP is not configured", async () => {
  const f = fixture(); const summary = await f.run({ smtp: null });
  assert(summary.skipped === "smtp-unconfigured" && summary.matches === 2 && f.sends.length === 0 && !f.calls.some((c) => c.path.endsWith("media_alert_recipients")));
});
Deno.test("skips when nobody subscribed", async () => {
  const f = fixture({ recipients: [] }); const summary = await f.run();
  assert(summary.skipped === "no-recipients" && f.sends.length === 0 && !f.calls.some((c) => c.path.endsWith("media_alert_deliveries")));
});
Deno.test("sends one digest to all recipients, records deliveries and marks matches notified", async () => {
  const f = fixture({ sendResult: { accepted: ["a@example.test"], rejected: [{ address: "b@example.test", code: 550 }] } });
  const summary = await f.run();
  assert(summary.sent === 1 && summary.failed === 1 && summary.recipients === 2 && summary.matches === 2 && f.sends.length === 1);
  const inserted = f.calls.find((c) => c.path.endsWith("media_alert_deliveries"))!.body as Array<Record<string, unknown>>;
  assert(inserted.length === 2 && inserted.every((d) => d.sync_run_id === 7 && d.match_count === 2));
  assert(inserted.find((d) => d.recipient_email === "a@example.test")!.status === "sent" && inserted.find((d) => d.recipient_email === "b@example.test")!.status === "failed");
  const marked = f.calls.find((c) => c.path.endsWith("media_obituary_matches") && c.method === "PATCH")!;
  assert(marked && (marked.body as { notified_at: string }).notified_at === "2026-09-15T00:30:00.000Z");
});
Deno.test("connection failure records every recipient as failed without marking matches", async () => {
  const f = fixture({ sendError: new SmtpError("auth", 535, "credentials invalid for sender@example.test") });
  const summary = await f.run();
  assert(summary.sent === 0 && summary.failed === 2);
  const inserted = f.calls.find((c) => c.path.endsWith("media_alert_deliveries"))!.body as Array<Record<string, string>>;
  assert(inserted.every((d) => d.status === "failed" && d.error_message.includes("auth") && !d.error_message.includes("sender@example.test")));
  assert(!f.calls.some((c) => c.path.endsWith("media_obituary_matches")));
});
Deno.test("delivery log failure propagates", async () => {
  const f = fixture({ failInsert: true });
  try { await f.run(); throw new Error("expected failure"); } catch (error) { assert(error instanceof Error && error.message.includes("이력")); }
});
Deno.test("digest lists matches with escaping, department fallback and links", () => {
  const digest = buildAlertDigest([match(1), match(2, null)], "https://app.test", new Date("2026-09-15T00:30:00Z"));
  assert(digest.subject === "[부고 알림] 관리 매체·부서 일치 2건 · 9월 15일", digest.subject);
  assert(digest.html.includes("&lt;script&gt;") && !digest.html.includes("<script>"), "escaped");
  assert(digest.html.includes("중앙일보 / 테크부") && digest.html.includes("부서 무관") && digest.html.includes("https://www.yna.co.kr/view/AKR20260915000000001"));
  assert(digest.html.includes("https://app.test/people-news") && digest.html.includes("https://app.test/media-directory"));
  assert(digest.text.includes("중앙일보 / 테크부") && digest.text.includes("원문: https://www.yna.co.kr/view/AKR20260915000000002"));
});
