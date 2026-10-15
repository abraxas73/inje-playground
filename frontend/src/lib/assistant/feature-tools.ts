/**
 * 이노봇이 부르는 우리 앱 기능 — Jira 내 업무·인사·부고·뭐 먹지·PPT 만들기. 서버에서 실행하고(웹·앱 공통), 페이지 권한은 runServerTool이 본다.
 * 쓰기(ppt_create)는 확인 카드 문구를 서버가 만든다(featureCard) — 앱은 그 문구를 그대로 보이므로 새 쓰기 도구에 앱 업데이트가 필요 없다.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PageKey } from "@/lib/page-access";
import type { ToolRun } from "./server-tools";
import { JiraError, connectionClient, loadConnection } from "@/lib/jira/client";
import { issueDetail, myIssues, type JiraIssue } from "@/lib/jira/issues";
import { startDeck } from "@/lib/ppt/start";

const APP = "https://innocrew.innogrid.com";
const S = (description: string) => ({ type: "string", description });
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): Anthropic.Tool => ({ name, description, input_schema: { type: "object", properties, required } });

export const FEATURE_TOOLS: Anthropic.Tool[] = [
  tool("jira_issues", "내 Jira 업무(나에게 배정된 이슈, 최근 수정 순 최대 20건) — key·제목·상태·우선순위·프로젝트·기한·링크.", { scope: S("open(미완료, 기본)|progress(진행 중)|done(완료)|all") }),
  tool("jira_issue", "Jira 이슈 상세(설명·댓글·가능한 상태 변경). 내 담당 이슈만.", { key: S("이슈 키(예: PAAS-123)") }, ["key"]),
  tool("people_news", "연합뉴스 인사·부고 소식(최근 순 최대 15건) — 구분·제목·요약·날짜·원문 링크.", { category: S("all(기본)|personnel(인사)|obituary(부고)"), query: S("제목 검색어(이름·회사 등, 선택)"), days: { type: "integer", description: "최근 며칠(1~30, 기본 7)" } }),
  tool("food_search", "근처 식당·카페 찾기(카카오맵, 가까운 순 10곳) 또는 PAYCO 식권 가맹점 찾기. near는 장소 이름이나 주소 — 사용자가 말하지 않았으면 어디 근처인지 먼저 묻는다.", { near: S("기준 위치(장소 이름 또는 주소)"), keyword: S("메뉴·가게 검색어(선택, 예: 국밥)"), kind: S("food(음식점, 기본)|cafe(카페)"), radius: { type: "integer", description: "반경 m(100~2000, 기본 500)" }, payco: { type: "boolean", description: "PAYCO 식권 가맹점만" } }, ["near"]),
  tool("ppt_decks", "내가 만든 PPT(PPT 만들기) 최근 10개 — 제목·상태(만드는 중·완성·실패)·장 수·링크. 만들기를 요청한 뒤 '다 됐어?'에 쓴다."),
  tool("ppt_create", "PPT 만들기 기능으로 이노그리드 표준 템플릿 PPT를 만든다(쓰기 — 사용자 확인 후 시작, 완성까지 몇 분). 원고는 text(마크다운 원고 — 대화에서 정리한 내용) 또는 url(웹·Confluence·SharePoint 문서 주소) 중 하나. 결과는 PPT 만들기 화면 링크.", { title: S("표지 제목(선택 — 비우면 원고에서)"), text: S("원고(마크다운, 장 구성·핵심 내용)"), url: S("원고 문서 주소(text 대신)"), prompt: S("만드는 방식 요청(선택, 예: 임원 보고용 10장 내외)") }),
];
export const FEATURE_TIERS: Record<string, "read" | "write"> = { jira_issues: "read", jira_issue: "read", people_news: "read", food_search: "read", ppt_decks: "read", ppt_create: "write" };
const PAGE: Record<string, PageKey> = { jira_issues: "jira", jira_issue: "jira", people_news: "people_news", food_search: "food", ppt_decks: "ppt", ppt_create: "ppt" };
export const featurePage = (name: string): PageKey | null => PAGE[name] ?? null;

const str = (a: Record<string, unknown>, k: string, max = 2000) => (typeof a[k] === "string" ? (a[k] as string).trim().slice(0, max) : "");
const PPT_NOTE = "완성까지 몇 분 걸리며 PPT 만들기 화면에서 확인합니다.";

/** 쓰기 확인 카드 줄(서버가 만든다). 기능 쓰기 도구가 아니면 null. */
export function featureCard(name: string, input: Record<string, unknown>): string[] | null {
  if (name !== "ppt_create") return null;
  const text = str(input, "text", 200_000), url = str(input, "url"), prompt = str(input, "prompt");
  return [
    `PPT 만들기 — ${str(input, "title") || "(제목은 원고에서)"}`,
    url ? `원고: ${url}` : `원고: ${text.slice(0, 120)}${text.length > 120 ? `… (${text.length.toLocaleString("ko-KR")}자)` : ""}`,
    ...(prompt ? [`요청: ${prompt}`] : []),
    PPT_NOTE,
  ];
}

const STATUS: Record<string, string> = { generating: "원고 정리 중", building: "PPT 만드는 중", done: "완성", failed: "실패" };

export async function runFeatureTool(admin: SupabaseClient, ctx: { userId: string; email: string }, name: string, args: Record<string, unknown>): Promise<ToolRun> {
  const fail = (error: string): ToolRun => ({ ok: false, error });
  const done = (result: unknown): ToolRun => ({ ok: true, result });
  try {
    if (name === "jira_issues" || name === "jira_issue") {
      const conn = await loadConnection(admin, ctx.userId);
      if (!conn) return fail("Jira 계정이 연결되지 않았습니다. 웹 설정에서 Atlassian 계정을 연결하세요.");
      const client = await connectionClient(conn, admin, ctx.userId);
      if (name === "jira_issue") return done(await issueDetail(client, conn.account_id, str(args, "key", 100)));
      const scope = str(args, "scope") || "open";
      if (!["open", "progress", "done", "all"].includes(scope)) return fail("scope는 open·progress·done·all 중 하나입니다.");
      const { items } = await myIssues(client, scope);
      return done({ items: (items as JiraIssue[]).slice(0, 20).map((i) => ({ key: i.key, summary: i.summary, status: i.status, priority: i.priority, project: i.project, dueDate: i.dueDate, url: i.url })) });
    }
    if (name === "people_news") {
      const category = str(args, "category") || "all";
      if (!["all", "personnel", "obituary"].includes(category)) return fail("category는 all·personnel·obituary 중 하나입니다.");
      const days = Math.min(30, Math.max(1, Number.isInteger(args.days) ? (args.days as number) : 7));
      let q = admin.from("yonhap_notices").select("category,title,summary,source_url,published_at").gte("published_at", new Date(Date.now() - days * 86_400_000).toISOString());
      if (category !== "all") q = q.eq("category", category);
      const query = str(args, "query", 50).replace(/[%_]/g, "");
      if (query) q = q.ilike("title", `%${query}%`);
      const { data, error } = await q.order("published_at", { ascending: false }).limit(15);
      if (error) return fail("인사·부고를 불러오지 못했습니다.");
      return done({ items: ((data ?? []) as Array<Record<string, string | null>>).map((n) => ({ category: n.category === "obituary" ? "부고" : "인사", title: n.title, summary: (n.summary ?? "").slice(0, 200), date: n.published_at, url: n.source_url })) });
    }
    if (name === "food_search") return await foodSearch(admin, args);
    if (name === "ppt_decks") {
      const { data: decks, error } = await admin.from("ppt_decks").select("id,title,updated_at").eq("owner_id", ctx.userId).order("updated_at", { ascending: false }).limit(10);
      if (error) return fail("PPT 목록을 불러오지 못했습니다.");
      const list = (decks ?? []) as Array<{ id: string; title: string; updated_at: string }>;
      const { data: vs } = list.length ? await admin.from("ppt_deck_versions").select("deck_id,no,status,slide_count").in("deck_id", list.map((d) => d.id)).order("no", { ascending: false }) : { data: [] };
      const latest = new Map<string, { no: number; status: string; slide_count: number | null }>();
      for (const v of (vs ?? []) as Array<{ deck_id: string; no: number; status: string; slide_count: number | null }>) if (!latest.has(v.deck_id)) latest.set(v.deck_id, v);
      return done({ decks: list.map((d) => { const v = latest.get(d.id); return { id: d.id, title: d.title, status: v ? STATUS[v.status] ?? v.status : "없음", slides: v?.slide_count ?? null, version: v?.no ?? null, updated: d.updated_at, url: `${APP}/ppt/${d.id}` }; }) });
    }
    if (name === "ppt_create") {
      const text = typeof args.text === "string" ? args.text : "", url = str(args, "url");
      if (!text.trim() && !url) return fail("원고(text) 또는 원고 주소(url)가 필요합니다.");
      // 모델이 넘긴 값 중 원고·제목·요청만 쓴다(파일 경로·템플릿 id 같은 내부 값은 받지 않는다)
      const body = { ...(str(args, "title") ? { title: str(args, "title") } : {}), ...(url ? { url } : { text }), ...(str(args, "prompt") ? { prompt: str(args, "prompt") } : {}) };
      const r = await startDeck(admin, ctx, body);
      if (!r.ok) return fail(r.error);
      return done({ started: true, deck_id: r.deckId, url: `${APP}/ppt/${r.deckId}`, note: `만들기 시작했습니다. ${PPT_NOTE}` });
    }
    return fail(`모르는 도구입니다: ${name}`);
  } catch (e) {
    if (e instanceof JiraError) return fail(e.message);
    console.error("[assistant] 기능 도구 실패:", name, e instanceof Error ? e.message.slice(0, 200) : e);
    return fail("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

type KakaoDoc = Record<string, unknown> & { x?: string; y?: string };
async function kakao(key: string, path: string, params: Record<string, string>): Promise<KakaoDoc[]> {
  const u = new URL(`https://dapi.kakao.com${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u.toString(), { headers: { Authorization: `KakaoAK ${key}` } });
  if (!res.ok) throw new Error(`kakao ${res.status}`);
  return ((await res.json()) as { documents?: KakaoDoc[] }).documents ?? [];
}

/** near(주소 → 장소 이름 순으로 찾음)를 좌표로 바꾼 뒤 카카오 거리순 검색, payco면 그 도로명 주소로 PAYCO 식권 가맹점. */
async function foodSearch(admin: SupabaseClient, args: Record<string, unknown>): Promise<ToolRun> {
  const near = str(args, "near", 100);
  if (!near) return { ok: false, error: "어디 근처인지(near) 알려 주세요." };
  const { data } = await admin.from("settings").select("value").eq("key", "kakao_rest_api_key").maybeSingle();
  const key = (data as { value?: string } | null)?.value;
  if (!key) return { ok: false, error: "관리자가 Kakao REST API 키를 설정하지 않았습니다." };
  const radius = Math.min(2000, Math.max(100, Number.isInteger(args.radius) ? (args.radius as number) : 500));
  const spot = (await kakao(key, "/v2/local/search/address.json", { query: near, size: "1" }))[0] ?? (await kakao(key, "/v2/local/search/keyword.json", { query: near, size: "1" }))[0];
  if (!spot?.x || !spot?.y) return { ok: false, error: `'${near}' 위치를 찾지 못했습니다. 주소나 더 알려진 장소 이름으로 다시 알려 주세요.` };
  const road = typeof spot.road_address_name === "string" && spot.road_address_name ? spot.road_address_name : ((spot.road_address as { address_name?: string } | null)?.address_name ?? String(spot.address_name ?? ""));
  const center = spot.place_name ? `${spot.place_name} (${road})` : road;
  if (args.payco === true) {
    const res = await fetch("https://bizplus.payco.com/ajax/merchant/map/myMerchants.json", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: road, distance: radius }) });
    if (!res.ok) return { ok: false, error: "PAYCO 가맹점을 불러오지 못했습니다." };
    const list = ((await res.json()) as { result?: Array<Record<string, unknown>> }).result ?? [];
    return { ok: true, result: { center, places: list.slice(0, 10).map((p) => ({ name: p.name, category: p.categoryName, distance_m: Number(p.distance), address: p.address, phone: p.telNo })) } };
  }
  const keyword = str(args, "keyword", 50);
  const params = { category_group_code: str(args, "kind") === "cafe" ? "CE7" : "FD6", x: String(spot.x), y: String(spot.y), radius: String(radius), sort: "distance", size: "15" };
  const docs = keyword ? await kakao(key, "/v2/local/search/keyword.json", { query: keyword, ...params }) : await kakao(key, "/v2/local/search/category.json", params);
  return { ok: true, result: { center, places: docs.slice(0, 10).map((d) => ({ name: d.place_name, category: String(d.category_name ?? "").split(" > ").at(-1), distance_m: Number(d.distance), address: d.road_address_name || d.address_name, phone: d.phone || undefined, url: d.place_url })) } };
}
