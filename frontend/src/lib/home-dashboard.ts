/** 홈 대시보드 레이아웃 — user_settings `home_dashboard`(계정 단위). 데스크톱 앱의 홈 위젯 배치(12칼럼 그리드). */
import type { SupabaseClient } from "@supabase/supabase-js";
import { ownerLabels } from "@/lib/ppt/owner-label";

export const HOME_DASHBOARD_KEY = "home_dashboard";
export const HOME_DASHBOARD_MAX = 40;
export const DASHBOARD_COLS = 12;

/** 배치할 수 있는 위젯 id(앱 홈 섹션과 1:1). 서버는 값만 검증하고 의미는 앱이 안다. */
export const DASHBOARD_WIDGET_IDS = [
  // greeting = 인사+오늘의 한 줄 결합 위젯. quote는 예전 분리 위젯(앱이 greeting으로 옮김) — 호환 위해 유지.
  "greeting", "quote", "messenger", "messenger_full", "teams_chat", "briefing", "confluence", "sharepoint", "focus", "meetings",
  "absence", "approvals", "mails", "talks", "teams", "notices", "quick", "services",
] as const;
export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** 그리드 한 칸 단위 배치. x·w는 칼럼(0..11, w 1..12, x+w<=12), y·h는 행 단위. */
export type DashboardTile = { id: string; x: number; y: number; w: number; h: number };

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

export function parseDashboard(raw: string | null | undefined): DashboardTile[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: DashboardTile[] = [];
    for (const t of list) {
      const id = t?.id;
      if (!DASHBOARD_WIDGET_IDS.includes(id) || seen.has(id)) continue;
      const x = int(t?.x, 0, DASHBOARD_COLS - 1);
      const y = int(t?.y, 0, 999);
      const w = int(t?.w, 1, DASHBOARD_COLS);
      const h = int(t?.h, 1, 40);
      if (x === null || y === null || w === null || h === null || x + w > DASHBOARD_COLS) continue;
      seen.add(id);
      out.push({ id, x, y, w, h });
      if (out.length >= HOME_DASHBOARD_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export async function loadDashboard(admin: SupabaseClient, userId: string): Promise<DashboardTile[]> {
  const { data, error } = await admin.from("user_settings").select("value").eq("user_id", userId).eq("key", HOME_DASHBOARD_KEY).maybeSingle();
  if (error) throw new Error(`대시보드 조회 실패: ${error.message}`);
  return parseDashboard((data as { value?: string } | null)?.value);
}

export async function saveDashboard(admin: SupabaseClient, userId: string, tiles: DashboardTile[]): Promise<void> {
  const { error } = await admin.from("user_settings").upsert(
    { user_id: userId, key: HOME_DASHBOARD_KEY, value: JSON.stringify(tiles), updated_at: new Date().toISOString() },
    { onConflict: "user_id,key" },
  );
  if (error) throw new Error(`대시보드 저장 실패: ${error.message}`);
}

/** 홈 대시보드 템플릿 — 테이블 home_dashboard_templates(service role만). 기본 템플릿 하나 + 사용자가 공유한 배치. */
export const TEMPLATE_PER_USER_MAX = 10;
export type DashboardTemplate = { id: string; name: string; owner: string; mine: boolean; isDefault: boolean; tiles: DashboardTile[]; createdAt: string };
type TemplateRow = { id: string; owner_id: string | null; owner_email: string; name: string; tiles: unknown; is_default: boolean; created_at: string };

/** 기본 템플릿 먼저, 그다음 최신 공유 순. owner는 "이름(팀)" 표시명. */
export async function listTemplates(admin: SupabaseClient, userId: string): Promise<DashboardTemplate[]> {
  const { data, error } = await admin.from("home_dashboard_templates").select("id, owner_id, owner_email, name, tiles, is_default, created_at")
    .order("is_default", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(`템플릿 조회 실패: ${error.message}`);
  const rows = (data ?? []) as TemplateRow[];
  const labels = await ownerLabels(admin, rows.map((r) => ({ email: r.owner_email, userId: r.owner_id })));
  return rows.map((r) => ({
    id: r.id, name: r.name, owner: labels.get(r.owner_email) ?? r.owner_email, mine: r.owner_id === userId, isDefault: r.is_default,
    tiles: parseDashboard(JSON.stringify(r.tiles)), createdAt: r.created_at,
  }));
}

/** 공유 — 사람당 TEMPLATE_PER_USER_MAX개까지. 넘으면 null. */
export async function createTemplate(admin: SupabaseClient, user: { userId: string; email: string }, name: string, tiles: DashboardTile[]): Promise<string | null> {
  const { count, error: cErr } = await admin.from("home_dashboard_templates").select("id", { count: "exact", head: true }).eq("owner_id", user.userId).eq("is_default", false);
  if (cErr) throw new Error(`템플릿 조회 실패: ${cErr.message}`);
  if ((count ?? 0) >= TEMPLATE_PER_USER_MAX) return null;
  const { data, error } = await admin.from("home_dashboard_templates").insert({ owner_id: user.userId, owner_email: user.email, name, tiles }).select("id").single();
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
