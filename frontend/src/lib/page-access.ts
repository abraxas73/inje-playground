import type { UserRole } from "./roles";

/** Shared catalog for navigation, administration and server route protection. */
export const PAGE_GROUPS = [
  { id: "daily", label: "일상·팀 활동" },
  { id: "ai", label: "AI·성과" },
  { id: "work", label: "업무·소식" },
] as const;
export const PAGES = [
  { key: "food", href: "/food", label: "뭐 먹지", group: "daily", minRole: "guest" },
  { key: "ladder", href: "/ladder", label: "사다리", group: "daily", minRole: "guest" },
  { key: "team", href: "/team", label: "커피 타임", group: "daily", minRole: "guest" },
  { key: "survey", href: "/survey", label: "설문", group: "daily", minRole: "guest" },
  { key: "usage_code", href: "/usage/code", label: "Claude Code", group: "ai", minRole: "user" },
  { key: "usage_chat", href: "/usage/chat", label: "Claude 채팅", group: "ai", minRole: "user" },
  { key: "usage_perf", href: "/usage/perf", label: "성과", group: "ai", minRole: "user" },
  { key: "rfp", href: "/rfp", label: "RFP 분석", group: "work", minRole: "user" },
  { key: "people_news", href: "/people-news", label: "인사·부고", group: "work", minRole: "user" },
  { key: "guide", href: "/guide", label: "가이드 (메뉴 숨김)", group: "work", minRole: "user", hidden: true },
] as const;
export type PageKey = typeof PAGES[number]["key"];
export type PagePermissions = Partial<Record<PageKey, boolean>>;
export const matchesPath = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
export function isPagePermissions(value: unknown): value is PagePermissions {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, allowed]) => PAGES.some((p) => p.key === key) && typeof allowed === "boolean");
}
export function canUsePage(role: UserRole, key: PageKey, permissions: PagePermissions = {}): boolean {
  if (role === "admin") return true;
  const page = PAGES.find((p) => p.key === key);
  if (!page || (page.minRole === "user" && role !== "user")) return false;
  return permissions[key] !== false;
}
/** Shared helper APIs require at least one of their consuming pages. */
export function pagesForPath(path: string): PageKey[] {
  if (matchesPath(path, "/rfp/shared") || matchesPath(path, "/api/rfp/shared")) return [];
  if (matchesPath(path, "/guide/admin") || matchesPath(path, "/admin") || matchesPath(path, "/api/admin")) return [];
  if (path === "/usage") return ["usage_code", "usage_chat", "usage_perf"];
  const page = PAGES.find((p) => matchesPath(path, p.href));
  if (page) return [page.key];
  const routes: Array<[string, PageKey[]]> = [
    ["/api/food", ["food"]], ["/api/ladder-sessions", ["ladder"]],
    ["/api/team-sessions", ["team"]], ["/api/team-attendance", ["team"]],
    ["/api/team-comments", ["team"]], ["/api/team-notify", ["team"]],
    ["/api/surveys", ["survey"]], ["/api/guide", ["guide"]],
    ["/api/rfp", ["rfp"]], ["/api/people-news", ["people_news"]],
    ["/api/usage/code", ["usage_code"]], ["/api/usage/tools", ["usage_code"]],
    ["/api/usage/hourly", ["usage_code"]], ["/api/usage/chat", ["usage_chat"]],
    ["/api/usage/office", ["usage_chat"]], ["/api/usage/perf", ["usage_perf"]],
    ["/api/usage/scope", ["usage_code", "usage_chat", "usage_perf"]],
  ];
  return routes.find(([prefix]) => matchesPath(path, prefix))?.[1] ?? [];
}
export function canOpenPage(role: UserRole, path: string, permissions: PagePermissions = {}) {
  if (matchesPath(path, "/admin") || matchesPath(path, "/guide/admin")) return role === "admin";
  const keys = pagesForPath(path);
  return keys.length ? keys.some((key) => canUsePage(role, key, permissions)) : ["/", "/profile", "/settings", "/manual"].includes(path);
}
