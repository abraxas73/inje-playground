// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  conn: { account_id: "acc1" } as unknown,
  myIssues: vi.fn(),
  issueDetail: vi.fn(),
  startDeck: vi.fn(),
  rows: {} as Record<string, unknown[]>,
  filters: [] as string[],
  settings: { kakao_rest_api_key: "kk" } as Record<string, string>,
}));
vi.mock("@/lib/jira/client", async (orig) => ({ ...(await orig<object>()), loadConnection: async () => m.conn, connectionClient: async () => "client" }));
vi.mock("@/lib/jira/issues", () => ({ myIssues: m.myIssues, issueDetail: m.issueDetail }));
vi.mock("@/lib/ppt/start", () => ({ startDeck: m.startDeck }));

import { featureCard, runFeatureTool, FEATURE_TOOLS, FEATURE_TIERS, featurePage } from "@/lib/assistant/feature-tools";

/** 체인형 가짜 Supabase — 테이블별 행, 걸린 조건을 기록한다. */
function fakeAdmin() {
  return {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      const chain = (name: string) => (...a: unknown[]) => { m.filters.push(`${table}.${name}(${a.map((x) => JSON.stringify(x)).join(",")})`); return q; };
      for (const k of ["select", "eq", "ilike", "gte", "order", "limit", "in"]) q[k] = chain(k);
      q.maybeSingle = async () => ({ data: table === "settings" ? { value: m.settings[String(m.filters.findLast((f) => f.startsWith("settings.eq"))?.match(/"([^"]+)"\)$/)?.[1])] } : null, error: null });
      q.then = (res: (v: unknown) => void) => res({ data: m.rows[table] ?? [], error: null });
      return q;
    },
  } as never;
}
const ctx = { userId: "u1", email: "a@innogrid.com" };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  m.conn = { account_id: "acc1" }; m.rows = {}; m.filters = []; m.settings = { kakao_rest_api_key: "kk" };
  m.myIssues.mockReset(); m.issueDetail.mockReset(); m.startDeck.mockReset();
  fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
});

describe("기능 도구 정의", () => {
  it("이름·등급·페이지 키 — ppt_create만 쓰기", () => {
    expect(FEATURE_TOOLS.map((t) => t.name).sort()).toEqual(["food_search", "jira_issue", "jira_issues", "people_news", "ppt_create", "ppt_decks"]);
    expect(FEATURE_TIERS).toEqual({ jira_issues: "read", jira_issue: "read", people_news: "read", food_search: "read", ppt_decks: "read", ppt_create: "write" });
    expect([featurePage("jira_issue"), featurePage("people_news"), featurePage("food_search"), featurePage("ppt_create"), featurePage("teams_send")]).toEqual(["jira", "people_news", "food", "ppt", null]);
  });
});

describe("Jira", () => {
  it("내 이슈 — 요약 필드만 최대 20건, 연결 없으면 안내", async () => {
    m.myIssues.mockResolvedValue({ items: Array.from({ length: 25 }, (_, i) => ({ key: `P-${i}`, summary: `일 ${i}`, status: "진행 중", statusId: "3", category: "indeterminate", priority: "High", project: "P", dueDate: null, updated: "u", url: `https://x/P-${i}` })), nextPageToken: null });
    const r = await runFeatureTool(fakeAdmin(), ctx, "jira_issues", { scope: "progress" });
    expect(m.myIssues).toHaveBeenCalledWith("client", "progress");
    expect(r.ok && (r.result as { items: unknown[] }).items).toHaveLength(20);
    expect(r.ok && (r.result as { items: Array<Record<string, unknown>> }).items[0]).toEqual({ key: "P-0", summary: "일 0", status: "진행 중", priority: "High", project: "P", dueDate: null, url: "https://x/P-0" });
    m.conn = null;
    expect(await runFeatureTool(fakeAdmin(), ctx, "jira_issues", {})).toEqual({ ok: false, error: expect.stringContaining("Jira 계정") });
  });
  it("이슈 상세 — 연결 계정으로, 잘못된 범위는 거절", async () => {
    m.issueDetail.mockResolvedValue({ key: "P-1", description: "설명", comments: [] });
    expect(await runFeatureTool(fakeAdmin(), ctx, "jira_issue", { key: "P-1" })).toEqual({ ok: true, result: { key: "P-1", description: "설명", comments: [] } });
    expect(m.issueDetail).toHaveBeenCalledWith("client", "acc1", "P-1");
    expect((await runFeatureTool(fakeAdmin(), ctx, "jira_issues", { scope: "x" })).ok).toBe(false);
  });
});

describe("인사·부고", () => {
  it("최근 소식 — 구분·검색어·기간 조건, 요약은 짧게", async () => {
    m.rows.yonhap_notices = [{ category: "obituary", title: "[부고] 홍길동씨 별세", summary: "가".repeat(500), source_url: "https://yna/1", published_at: "2026-10-15T00:00:00Z" }];
    const r = await runFeatureTool(fakeAdmin(), ctx, "people_news", { category: "obituary", query: "홍길동", days: 3 });
    expect(r.ok).toBe(true);
    const item = (r as { result: { items: Array<{ summary: string; title: string }> } }).result.items[0];
    expect(item.title).toBe("[부고] 홍길동씨 별세");
    expect(item.summary.length).toBeLessThanOrEqual(200);
    expect(m.filters).toEqual(expect.arrayContaining(['yonhap_notices.eq("category","obituary")', 'yonhap_notices.ilike("title","%홍길동%")', 'yonhap_notices.limit(15)']));
    expect(m.filters.some((f) => f.startsWith("yonhap_notices.gte(\"published_at\""))).toBe(true);
    expect((await runFeatureTool(fakeAdmin(), ctx, "people_news", { category: "x" })).ok).toBe(false);
  });
});

describe("뭐 먹지", () => {
  const kakao = (docs: unknown[]) => new Response(JSON.stringify({ documents: docs, meta: { is_end: true } }), { status: 200 });
  it("장소 이름을 좌표로 바꾼 뒤 거리순 음식점 10곳", async () => {
    fetchMock.mockResolvedValueOnce(kakao([])) // 주소 검색: 없음
      .mockResolvedValueOnce(kakao([{ x: "127.1", y: "37.4", place_name: "판교역", road_address_name: "경기 성남시 분당구 판교역로 160", address_name: "삼평동" }]))
      .mockResolvedValueOnce(kakao(Array.from({ length: 12 }, (_, i) => ({ place_name: `식당${i}`, category_name: "음식점 > 한식", distance: String(i * 10), road_address_name: "주소", phone: "031", place_url: `https://place/${i}` }))));
    const r = await runFeatureTool(fakeAdmin(), ctx, "food_search", { near: "판교역", keyword: "국밥" });
    expect(r.ok).toBe(true);
    const res = (r as { result: { center: string; places: Array<Record<string, unknown>> } }).result;
    expect(res.center).toBe("판교역 (경기 성남시 분당구 판교역로 160)");
    expect(res.places).toHaveLength(10);
    expect(res.places[1]).toEqual({ name: "식당1", category: "한식", distance_m: 10, address: "주소", phone: "031", url: "https://place/1" });
    const search = new URL(fetchMock.mock.calls[2][0] as string);
    expect(search.pathname).toBe("/v2/local/search/keyword.json");
    expect(Object.fromEntries(search.searchParams)).toMatchObject({ query: "국밥", category_group_code: "FD6", x: "127.1", y: "37.4", radius: "500", sort: "distance" });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toEqual({ Authorization: "KakaoAK kk" });
  });
  it("PAYCO 식권 가맹점 — 찾은 위치의 도로명 주소로, 위치를 못 찾으면 되묻게", async () => {
    fetchMock.mockResolvedValueOnce(kakao([{ x: "127.1", y: "37.4", address_name: "경기 성남시 분당구 삼평동 681", road_address: { address_name: "경기 성남시 분당구 판교역로 235" } }]))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: [{ mrcCd: "1", name: "김밥집", categoryName: "분식", address: "판교", telNo: "02", distance: 120 }] }), { status: 200 }));
    const r = await runFeatureTool(fakeAdmin(), ctx, "food_search", { near: "판교역로 235", payco: true, radius: 300 });
    expect((r as { result: { places: unknown[] } }).result.places).toEqual([{ name: "김밥집", category: "분식", distance_m: 120, address: "판교", phone: "02" }]);
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ address: "경기 성남시 분당구 판교역로 235", distance: 300 });
    fetchMock.mockReset().mockImplementation(async () => kakao([]));
    expect(await runFeatureTool(fakeAdmin(), ctx, "food_search", { near: "없는 곳" })).toEqual({ ok: false, error: expect.stringContaining("위치를 찾지 못했습니다") });
    expect((await runFeatureTool(fakeAdmin(), ctx, "food_search", {})).ok).toBe(false);
  });
});

describe("PPT", () => {
  it("내 덱 — 최근 10개, 최신 버전 상태와 링크", async () => {
    m.rows.ppt_decks = [{ id: "d1", title: "주간보고", updated_at: "2026-10-15T00:00:00Z" }];
    m.rows.ppt_deck_versions = [{ deck_id: "d1", no: 2, status: "done", slide_count: 12 }, { deck_id: "d1", no: 1, status: "failed", slide_count: null }];
    const r = await runFeatureTool(fakeAdmin(), ctx, "ppt_decks", {});
    expect((r as { result: { decks: unknown[] } }).result.decks).toEqual([{ id: "d1", title: "주간보고", status: "완성", slides: 12, version: 2, updated: "2026-10-15T00:00:00Z", url: "https://innocrew.innogrid.com/ppt/d1" }]);
    expect(m.filters).toEqual(expect.arrayContaining(['ppt_decks.eq("owner_id","u1")', "ppt_decks.limit(10)"]));
  });
  it("만들기 — 원고(text|url)·제목·요청만 넘기고 링크를 돌려준다, 실패는 그 문구", async () => {
    m.startDeck.mockResolvedValue({ ok: true, deckId: "d9" });
    const r = await runFeatureTool(fakeAdmin(), ctx, "ppt_create", { title: "3분기 실적", text: "# 매출\n- 20% 성장", prompt: "임원 보고용 10장", templateId: "x", storagePath: "u1/a.pdf" });
    expect(m.startDeck).toHaveBeenCalledWith(expect.anything(), ctx, { title: "3분기 실적", text: "# 매출\n- 20% 성장", prompt: "임원 보고용 10장" });
    expect(r).toEqual({ ok: true, result: { started: true, deck_id: "d9", url: "https://innocrew.innogrid.com/ppt/d9", note: expect.stringContaining("몇 분") } });
    await runFeatureTool(fakeAdmin(), ctx, "ppt_create", { url: "https://wiki.innogrid.com/x" });
    expect(m.startDeck).toHaveBeenLastCalledWith(expect.anything(), ctx, { url: "https://wiki.innogrid.com/x" });
    m.startDeck.mockResolvedValue({ ok: false, status: 409, error: "진행 중인 생성이 끝난 뒤 다시 시도하세요." });
    expect(await runFeatureTool(fakeAdmin(), ctx, "ppt_create", { text: "x" })).toEqual({ ok: false, error: "진행 중인 생성이 끝난 뒤 다시 시도하세요." });
    expect((await runFeatureTool(fakeAdmin(), ctx, "ppt_create", {})).ok).toBe(false);
  });
  it("확인 카드 — 제목·원고(앞부분 또는 주소)·요청을 보인다", () => {
    expect(featureCard("ppt_create", { title: "3분기 실적", text: "가".repeat(300), prompt: "10장" })).toEqual(["PPT 만들기 — 3분기 실적", `원고: ${"가".repeat(120)}… (300자)`, "요청: 10장", "완성까지 몇 분 걸리며 PPT 만들기 화면에서 확인합니다."]);
    expect(featureCard("ppt_create", { url: "https://wiki.innogrid.com/x" })).toEqual(["PPT 만들기 — (제목은 원고에서)", "원고: https://wiki.innogrid.com/x", "완성까지 몇 분 걸리며 PPT 만들기 화면에서 확인합니다."]);
    expect(featureCard("jira_issues", {})).toBeNull();
  });
});
