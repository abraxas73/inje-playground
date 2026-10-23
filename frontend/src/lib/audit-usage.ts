/**
 * 어드민 Audit "기능별 사용" — DB 함수 `audit_feature_usage`(docs/sql/2026-10-23-audit-feature-usage.sql) 결과를 화면용으로 바꾼다.
 * 페이지 열람 경로는 lib/page-access.ts의 페이지 키로 묶고, 사용자 id는 고유 수만 세서 내보내지 않는다.
 */
import { AUDIT_CATEGORY_LABEL } from "./audit";
import { PAGES, pagesForPath } from "./page-access";
import type { FeatureUsageResponse } from "@/types/audit";

export interface FeatureUsageRaw {
  categories?: Array<{ category: string; count: number; users: number }> | null;
  pages?: Array<{ path: string; count: number; userIds: string[] | null }> | null;
  platforms?: Array<{ platform: string; users: number }> | null;
  loginUsers?: number | null;
}

export const USAGE_PLATFORMS = ["iOS", "Android", "macOS", "Windows", "웹"] as const;
const OTHER_PAGE = { key: "other", label: "기타(홈·설정·관리 등)" };

export function summarizeFeatureUsage(raw: FeatureUsageRaw | null | undefined): Omit<FeatureUsageResponse, "from" | "to"> {
  const categories = (raw?.categories ?? []).map((c) => ({ category: c.category, label: AUDIT_CATEGORY_LABEL[c.category] ?? (c.category || "(없음)"), count: Number(c.count), users: Number(c.users) }));
  const byKey = new Map<string, { count: number; users: Set<string> }>();
  for (const p of raw?.pages ?? []) {
    const key = pagesForPath(p.path)[0] ?? OTHER_PAGE.key;
    const slot = byKey.get(key) ?? { count: 0, users: new Set<string>() };
    slot.count += Number(p.count);
    for (const id of p.userIds ?? []) slot.users.add(id);
    byKey.set(key, slot);
  }
  const pages = [...byKey].map(([key, v]) => ({ key, label: PAGES.find((p) => p.key === key)?.label ?? OTHER_PAGE.label, count: v.count, users: v.users.size }))
    .sort((a, b) => b.count - a.count);
  const platformUsers = new Map((raw?.platforms ?? []).map((p) => [p.platform, Number(p.users)]));
  const platforms = USAGE_PLATFORMS.map((platform) => ({ platform, users: platformUsers.get(platform) ?? 0 }));
  return { categories, pages, platforms, loginUsers: Number(raw?.loginUsers ?? 0) };
}
