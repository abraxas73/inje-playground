import type { UserRole } from "./roles";

/** Shared catalog for navigation, administration and server route protection. */
/** 상위 메뉴 — 앱 하단 바(mobile/lib/more/catalog.dart pageGroups)와 id·라벨을 맞춘다(2026-10-11). 앱 전용 '아마란스' 그룹은 웹에 두지 않는다(사용자 요청, 웹 메뉴 끝은 사용자 매뉴얼). */
export const PAGE_GROUPS = [
  { id: "daily", label: "일상" },
  { id: "ai", label: "AI" },
  { id: "work", label: "업무" },
] as const;
export const PAGES = [
  { key: "food", href: "/food", label: "뭐 먹지", group: "daily", minRole: "guest" },
  { key: "ladder", href: "/ladder", label: "사다리", group: "daily", minRole: "guest" },
  { key: "team", href: "/team", label: "커피 타임", group: "daily", minRole: "guest" },
  { key: "survey", href: "/survey", label: "설문", group: "daily", minRole: "guest" },
  { key: "apps", href: "/apps", label: "모바일 앱", group: "daily", minRole: "user" },
  { key: "usage_code", href: "/usage/code", label: "Claude Code", group: "ai", minRole: "user" },
  { key: "usage_chat", href: "/usage/chat", label: "Claude 채팅", group: "ai", minRole: "user" },
  { key: "usage_perf", href: "/usage/perf", label: "성과", group: "ai", minRole: "user" },
  { key: "teams_chat", href: "/teams/chat", label: "Teams 채팅", group: "work", minRole: "user" },
  { key: "jira", href: "/jira", label: "Jira", group: "work", minRole: "user" },
  { key: "confluence", href: "/confluence", label: "Confluence", group: "work", minRole: "user" },
  { key: "sharepoint", href: "/sharepoint", label: "SharePoint 문서", group: "work", minRole: "user" },
  { key: "rfp", href: "/rfp", label: "RFP 분석", group: "work", minRole: "user" },
  { key: "ppt", href: "/ppt", label: "PPT 만들기", group: "work", minRole: "user" },
  { key: "people_news", href: "/people-news", label: "인사·부고", group: "work", minRole: "user" },
  { key: "marketing", href: "/marketing", label: "마케팅 Master DB", group: "work", minRole: "user" },
  // 아마란스 메일(웹은 데스크톱 앱 중계). 키는 앱 catalog.dart appPages와 같아 한 스위치로 웹·앱을 함께 제어한다. 웹 메뉴에는 안 보이고 매뉴얼 링크로 연다. DB 함수 키 목록은 docs/sql/2026-10-11-page-keys-sync.sql
  { key: "gw_mail", href: "/gw/mail", label: "메일 (메뉴 숨김)", group: "work", minRole: "user", hidden: true },
  { key: "guide", href: "/guide", label: "가이드 (메뉴 숨김)", group: "work", minRole: "user", hidden: true },
  { key: "mcp", href: "/apps#mcp", label: "Claude 커넥터 (메뉴 숨김)", group: "work", minRole: "user", hidden: true },
] as const;
export type PageKey = typeof PAGES[number]["key"];
/** Pages that are denied unless a permission explicitly allows them (or a page-specific designation applies). */
export const DEFAULT_DENIED_PAGES: ReadonlySet<PageKey> = new Set<PageKey>(["marketing"]);
export type PagePermissions = Partial<Record<PageKey, boolean>>;
export const matchesPath = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
export function isPagePermissions(value: unknown): value is PagePermissions {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.entries(value).every(([key, allowed]) => PAGES.some((p) => p.key === key) && typeof allowed === "boolean");
}
export function canUsePage(role: UserRole, key: PageKey, permissions: PagePermissions = {}): boolean {
  // Marketing is denied by default: the server merges fixed managers, designated reviewers and an explicit permission into `permissions.marketing`.
  if (key === "marketing") return (role === "admin" || role === "user") && permissions.marketing === true;
  if (role === "admin") return true;
  const page = PAGES.find((p) => p.key === key);
  if (!page || (page.minRole === "user" && role !== "user")) return false;
  return permissions[key] !== false;
}
/** Shared helper APIs require at least one of their consuming pages. */
export function pagesForPath(path: string): PageKey[] {
  if (matchesPath(path, "/rfp/shared") || matchesPath(path, "/api/rfp/shared")) return [];
  if (matchesPath(path, "/ppt/s") || matchesPath(path, "/api/ppt/shared")) return [];
  if (matchesPath(path, "/guide/admin") || matchesPath(path, "/admin") || matchesPath(path, "/api/admin")) return [];
  if (path === "/usage") return ["usage_code", "usage_chat", "usage_perf"];
  const page = PAGES.find((p) => matchesPath(path, p.href));
  if (page) return [page.key];
  const routes: Array<[string, PageKey[]]> = [
    ["/api/food", ["food"]], ["/api/ladder-sessions", ["ladder"]],
    ["/api/team-sessions", ["team"]], ["/api/team-attendance", ["team"]],
    ["/api/team-comments", ["team"]], ["/api/team-notify", ["team"]],
    ["/api/surveys", ["survey"]], ["/api/guide", ["guide"]], ["/api/teams/chat", ["teams_chat"]], ["/api/teams/mentions", ["teams_chat"]],
    ["/api/rfp", ["rfp"]], ["/api/ppt", ["ppt"]], ["/api/people-news", ["people_news"]],
    ["/api/marketing", ["marketing"]], ["/api/jira", ["jira"]], ["/api/confluence", ["confluence"]], ["/api/sharepoint", ["sharepoint"]], ["/api/mcp", ["mcp"]], ["/api/gw/mail", ["gw_mail"]],
    ["/media-directory", ["people_news"]], ["/api/media-directory", ["people_news"]],
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
