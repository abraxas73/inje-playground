/** 홈 대시보드 레이아웃 — user_settings `home_dashboard`(계정 단위). 데스크톱 앱의 홈 위젯 배치(12칼럼 그리드). */
import type { SupabaseClient } from "@supabase/supabase-js";

export const HOME_DASHBOARD_KEY = "home_dashboard";
export const HOME_DASHBOARD_MAX = 40;
export const DASHBOARD_COLS = 12;

/** 배치할 수 있는 위젯 id(앱 홈 섹션과 1:1). 서버는 값만 검증하고 의미는 앱이 안다. */
export const DASHBOARD_WIDGET_IDS = [
  "quote", "briefing", "confluence", "sharepoint", "focus", "meetings",
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
