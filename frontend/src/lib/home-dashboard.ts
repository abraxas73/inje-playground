/** 홈 대시보드 레이아웃 — user_settings `home_dashboard`(계정 단위). 데스크톱 앱의 홈 위젯 배치.
 * 2026-11-03부터 24칸 그리드(가로·세로 모두 옛 12칸의 두 배 촘촘). 저장은 `{cols:24, tiles}`, 옛 값(배열)은 12칸.
 * API는 요청한 단위(`cols`, 없으면 12 = 옛 앱)로 바꿔 주고 받는다 — 옛 앱과 새 앱이 같은 배치를 함께 쓴다. */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerLabels } from "@/lib/ppt/owner-label";

export const HOME_DASHBOARD_KEY = "home_dashboard";
export const HOME_DASHBOARD_MAX = 40;
export const DASHBOARD_COLS = 12;
export const DASHBOARD_FINE_COLS = 24;
export type DashboardCols = 12 | 24;
/** 요청의 cols 값 → 단위. 24가 아니면 옛 12칸. */
export const colsOf = (v: unknown): DashboardCols => (v === 24 || v === "24" ? 24 : 12);

/** 배치할 수 있는 위젯 id(앱 홈 섹션과 1:1). 서버는 값만 검증하고 의미는 앱이 안다. */
export const DASHBOARD_WIDGET_IDS = [
  // greeting = 인사+오늘의 한 줄 결합 위젯. quote는 예전 분리 위젯(앱이 greeting으로 옮김) — 호환 위해 유지.
  "greeting", "quote", "messenger", "messenger_full", "teams_chat", "briefing", "confluence", "sharepoint", "focus", "meetings",
  "absence", "approvals", "mails", "talks", "teams", "notices", "quick", "services", "todo",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** 그리드 한 칸 단위 배치. x·w는 칼럼(0..cols-1, w 1..cols, x+w<=cols), y·h는 행 단위. */
export type DashboardTile = { id: string; x: number; y: number; w: number; h: number };

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** 검증 통과분만(모르는 id·범위 밖·넘침·중복은 버림, 최대 40). 범위는 cols 단위 — 행 상한도 같은 배율. */
function parseTiles(list: unknown[], cols: DashboardCols): DashboardTile[] {
  const k = cols / DASHBOARD_COLS;
  const seen = new Set<string>();
  const out: DashboardTile[] = [];
  for (const t of list as { id?: unknown; x?: unknown; y?: unknown; w?: unknown; h?: unknown }[]) {
    const id = t?.id as DashboardWidgetId;
    if (!DASHBOARD_WIDGET_IDS.includes(id) || seen.has(id)) continue;
    const x = int(t?.x, 0, cols - 1);
    const y = int(t?.y, 0, 999 * k);
    const w = int(t?.w, 1, cols);
    const h = int(t?.h, 1, 40 * k);
    if (x === null || y === null || w === null || h === null || x + w > cols) continue;
    seen.add(id);
    out.push({ id, x, y, w, h });
    if (out.length >= HOME_DASHBOARD_MAX) break;
  }
  return out;
}

export function parseDashboard(raw: string | null | undefined, cols: DashboardCols = DASHBOARD_COLS): DashboardTile[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? parseTiles(list, cols) : [];
  } catch {
    return [];
  }
}

/** 12칸 ↔ 24칸(가로·세로 같은 배율). 줄일 땐 위치는 내림·크기는 올림(최소 1), 오른쪽 넘침은 폭을 줄인다. */
export function rescale(tiles: DashboardTile[], from: DashboardCols, to: DashboardCols): DashboardTile[] {
  if (from === to) return tiles;
  if (to > from) return tiles.map((t) => ({ ...t, x: t.x * 2, y: t.y * 2, w: t.w * 2, h: t.h * 2 }));
  return tiles.map((t) => {
    const x = Math.floor(t.x / 2);
    return { ...t, x, y: Math.floor(t.y / 2), w: Math.min(Math.max(1, Math.ceil(t.w / 2)), DASHBOARD_COLS - x), h: Math.max(1, Math.ceil(t.h / 2)) };
  });
}

/** 저장 값(옛 배열 = 12칸, `{cols, tiles}`) → 24칸 타일. user_settings는 문자열, 템플릿 tiles는 jsonb. */
export function decodeDashboard(raw: unknown): DashboardTile[] {
  let v = raw;
  if (typeof v === "string") {
    try { v = JSON.parse(v); } catch { return []; }
  }
  if (Array.isArray(v)) return rescale(parseTiles(v, DASHBOARD_COLS), DASHBOARD_COLS, DASHBOARD_FINE_COLS);
  const o = v as { cols?: unknown; tiles?: unknown } | null;
  if (!o || typeof o !== "object" || !Array.isArray(o.tiles)) return [];
  const cols = colsOf(o.cols);
  return rescale(parseTiles(o.tiles, cols), cols, DASHBOARD_FINE_COLS);
}

/** 24칸 타일 → 저장 값. */
export const encodeDashboard = (tiles: DashboardTile[]) => ({ cols: DASHBOARD_FINE_COLS, tiles });

/** 24칸 단위로 읽는다. */
export async function loadDashboard(admin: SupabaseClient, userId: string): Promise<DashboardTile[]> {
  const { data, error } = await admin.from("user_settings").select("value").eq("user_id", userId).eq("key", HOME_DASHBOARD_KEY).maybeSingle();
  if (error) throw new Error(`대시보드 조회 실패: ${error.message}`);
  return decodeDashboard((data as { value?: string } | null)?.value);
}

/** tiles는 24칸 단위. */
export async function saveDashboard(admin: SupabaseClient, userId: string, tiles: DashboardTile[]): Promise<void> {
  const { error } = await admin.from("user_settings").upsert(
    { user_id: userId, key: HOME_DASHBOARD_KEY, value: JSON.stringify(encodeDashboard(tiles)), updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" },
  );
  if (error) throw new Error(`대시보드 저장 실패: ${error.message}`);
}

/** 홈 대시보드 템플릿 — 테이블 home_dashboard_templates(service role만). 기본 템플릿 하나 + 사용자가 공유한 배치. */
export const TEMPLATE_PER_USER_MAX = 10;
export type DashboardTemplate = { id: string; name: string; owner: string; mine: boolean; isDefault: boolean; tiles: DashboardTile[]; createdAt: string };
type TemplateRow = { id: string; owner_id: string | null; owner_email: string; name: string; tiles: unknown; is_default: boolean; created_at: string };

/** 기본 템플릿 먼저, 그다음 최신 공유 순. owner는 "이름(팀)" 표시명. tiles는 24칸 단위. */
export async function listTemplates(admin: SupabaseClient, userId: string): Promise<DashboardTemplate[]> {
  const { data, error } = await admin.from("home_dashboard_templates").select("id, owner_id, owner_email, name, tiles, is_default, created_at")
    .order("is_default", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`템플릿 조회 실패: ${error.message}`);
  const rows = (data ?? []) as TemplateRow[];
  const labels = await ownerLabels(admin, rows.map((r) => ({ email: r.owner_email, userId: r.owner_id })));
  return rows.map((r) => ({
    id: r.id, name: r.name, owner: labels.get(r.owner_email) ?? r.owner_email, mine: r.owner_id === userId, isDefault: r.is_default,
    tiles: decodeDashboard(r.tiles), createdAt: r.created_at,
  }));
}

/** 공유 — 사람당 TEMPLATE_PER_USER_MAX개까지. 넘으면 null. tiles는 24칸 단위. */
export async function createTemplate(admin: SupabaseClient, user: { userId: string; email: string }, name: string, tiles: DashboardTile[]): Promise<string | null> {
  const { count, error: cErr } = await admin.from("home_dashboard_templates").select("id", { count: "exact", head: true }).eq("owner_id", user.userId).eq("is_default", false);
  if (cErr) throw new Error(`템플릿 조회 실패: ${cErr.message}`);
  if ((count ?? 0) >= TEMPLATE_PER_USER_MAX) return null;
  const { data, error } = await admin.from("home_dashboard_templates").insert({ owner_id: user.userId, owner_email: user.email, name, tiles: encodeDashboard(tiles) }).select("id").single();
  if (error) throw new Error(`템플릿 저장 실패: ${error.message}`);
  return (data as { id: string }).id;
}

/** 삭제 — 본인 것만(기본 템플릿은 관리자만). 지운 행이 없으면 false. */
export async function deleteTemplate(admin: SupabaseClient, caller: { userId: string; role: string }, id: string): Promise<boolean> {
  let q = admin.from("home_dashboard_templates").delete().eq("id", id);
  if (caller.role !== "admin") q = q.eq("owner_id", caller.userId).eq("is_default", false);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`템플릿 삭제 실패: ${error.message}`);
  return (data ?? []).length > 0;
}
