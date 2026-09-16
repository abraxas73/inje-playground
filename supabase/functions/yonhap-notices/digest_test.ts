import { createClient } from "@supabase/supabase-js";
import { buildDigest, loadDigest } from "./digest.ts";

function assert(value: unknown, message = "assertion failed"): asserts value { if (!value) throw new Error(message); }
const notice = { title: "[부고] 홍길동(중앙일보 기자)씨 부친상", summary: "▲ 홍길순씨 별세", source_url: "https://www.yna.co.kr/view/AKR20260915000000001", published_at: "2026-09-15T10:02:49Z" };

Deno.test("subject and body follow the KST date, counts and period", () => {
  const digest = buildDigest([notice], 13, "2026-09-15T23:49:22Z", "2026-09-15T23:37:50Z", "https://app.test", "2026-09-14T23:49:22Z");
  assert(digest.subject === "[인사·부고] 2026. 9. 16. 새 소식 13건", digest.subject);
  assert(digest.html.includes("새로 수집된 인사·부고 13건입니다. 최신 1건을 표시합니다.") && digest.text.includes("최신 1건"));
  assert(digest.html.includes("포함 범위: 2026. 9. 15. 8시 49분 22초 ~ 2026. 9. 16. 8시 49분 22초") , digest.html);
  assert(digest.html.includes("마지막 수집: 2026. 9. 16. 8시 37분 50초 (한국 시간)"));
  assert(digest.html.includes(`href="${notice.source_url}"`) && digest.text.includes(notice.source_url));
  assert(digest.html.includes('href="https://app.test/people-news"') && digest.html.includes("수신 해제"));
});
Deno.test("empty digest says so and never fails", () => {
  const digest = buildDigest([], 0, "2026-09-15T23:49:22Z", null, "https://app.test");
  assert(digest.subject.endsWith("새 소식 0건") && digest.html.includes("새로 수집된 인사·부고 소식이 없습니다.") && digest.html.includes("아직 수집이 완료되지 않았습니다."));
});
Deno.test("escapes article HTML and replaces unsafe source links", () => {
  const digest = buildDigest([{ title: "<img onerror=x>", summary: "<script>x</script>", source_url: "javascript:x", published_at: "2026-09-11T00:00:00Z" }], 1, "2026-09-11T00:00:00Z", null, "https://app.test");
  assert(!digest.html.includes("<script>") && !digest.html.includes("javascript:") && digest.html.includes("&lt;img"));
  assert(digest.text.includes("https://app.test/people-news"));
});
Deno.test("rejects a non-HTTPS app URL", () => {
  let threw = false;
  try { buildDigest([], 0, "2026-09-11T00:00:00Z", null, "http://app.test"); } catch { threw = true; }
  assert(threw);
});
Deno.test("loadDigest queries stored notices in [from, to) with an exact count and the last successful sync", async () => {
  const calls: { path: string; query: string; headers: Headers }[] = [];
  const admin = createClient("https://test.supabase.co", "service-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); calls.push({ path: url.pathname, query: url.search, headers: new Headers(init?.headers) });
    if (url.pathname.endsWith("/yonhap_notices")) return new Response(JSON.stringify([notice, notice]), { status: 200, headers: { "Content-Type": "application/json", "Content-Range": "0-1/57" } });
    if (url.pathname.endsWith("/yonhap_notice_sync_runs")) return Response.json({ finished_at: "2026-09-15T22:00:02Z" });
    return Response.json({ message: `unexpected ${url.pathname}` }, { status: 500 });
  } } });
  const { digest, count } = await loadDigest(admin, "2026-09-14T23:49:22Z", "2026-09-15T23:49:22Z", "https://app.test");
  assert(count === 57 && digest.subject.endsWith("새 소식 57건") && digest.html.includes("최신 2건을 표시합니다."));
  const notices = calls.find((c) => c.path.endsWith("/yonhap_notices"))!;
  assert(notices.query.includes("created_at=gte.2026-09-14T23%3A49%3A22Z") && notices.query.includes("created_at=lt.2026-09-15T23%3A49%3A22Z") && notices.query.includes("limit=100"), notices.query);
  assert(notices.headers.get("Prefer")?.includes("count=exact"));
  const sync = calls.find((c) => c.path.endsWith("/yonhap_notice_sync_runs"))!;
  assert(sync.query.includes("status=eq.success") && sync.query.includes("limit=1"));
  assert(digest.html.includes("마지막 수집: 2026. 9. 16. 7시 0분 2초"));
});
