import type { DesktopPlatform } from "./release";

/** 홈 설치 카드 "다음에" 저장 키(localStorage, ISO 시각) — 브라우저 단위로 30일 숨김 */
export const DISMISS_KEY = "desktop_app_card_dismissed_at";
export const DISMISS_DAYS = 30;

export type Presence = Record<DesktopPlatform, string | null>;

export type AppPlatform = "ios" | "android" | DesktopPlatform;
export type AppInstall = { version: string; build: number | null; at: string };
/** 플랫폼별 가장 최근 앱 로그인(= 설치 현황). 없는 플랫폼은 키 없음 */
export type AppInstalls = Partial<Record<AppPlatform, AppInstall>>;

/** 앱 로그인 User-Agent `InnogridApp/<ver> (<platform>) InnogridBuild/<n>`(mobile/lib/config.dart) → 플랫폼·버전·빌드. 앱이 아니면 null.
 *  platform은 Flutter `defaultTargetPlatform.name`이라 `macOS`·`windows`·`iOS`·`android`처럼 대소문자가 섞여 있다 — 실측(2026-10-10) 뒤 대소문자 무시. */
export function parseAppUa(ua: string | null | undefined): { platform: AppPlatform; version: string; build: number | null } | null {
  const m = /^InnogridApp\/(\S+) \((ios|android|macos|windows|linux)\)(?: InnogridBuild\/(\d+))?/i.exec(ua ?? "");
  return m ? { platform: m[2].toLowerCase() as AppPlatform, version: m[1], build: m[3] ? Number(m[3]) : null } : null;
}

/** 앱 로그인 User-Agent → 데스크톱 플랫폼(홈 설치 안내 카드용) */
export function appPlatform(ua: string | null | undefined): DesktopPlatform | null {
  const p = parseAppUa(ua)?.platform;
  return p === "macos" || p === "windows" || p === "linux" ? p : null;
}

/** login_history 행(최신순) → 사용자별·플랫폼별 가장 최근 앱 로그인(관리자 사용자 목록의 설치 현황) */
export function installsFromRows(rows: { user_id: string; user_agent: string | null; logged_in_at: string }[]): Record<string, AppInstalls> {
  const out: Record<string, AppInstalls> = {};
  for (const r of rows) {
    const p = parseAppUa(r.user_agent);
    if (!p) continue;
    const mine = (out[r.user_id] ??= {});
    if (!mine[p.platform]) mine[p.platform] = { version: p.version, build: p.build, at: r.logged_in_at };
  }
  return out;
}

/** 브라우저 UA → 데스크톱 OS. 모바일·태블릿은 null. iPadOS Safari는 Macintosh로 위장하므로 터치 지점 수로 거른다. */
export function browserPlatform(ua: string, maxTouchPoints = 0): DesktopPlatform | null {
  if (/Android|iPhone|iPad|iPod|Mobile|CrOS/i.test(ua)) return null;
  if (/Windows NT/.test(ua)) return "windows";
  if (/Macintosh/.test(ua) && maxTouchPoints < 2) return "macos";
  if (/Linux|X11/.test(ua)) return "linux";
  return null;
}

/** login_history 행(최신순) → 플랫폼별 가장 최근 앱 로그인 시각 */
export function presenceFromRows(rows: { user_agent: string | null; logged_in_at: string }[]): Presence {
  const p: Presence = { macos: null, windows: null, linux: null };
  for (const r of rows) {
    const k = appPlatform(r.user_agent);
    if (k && !p[k]) p[k] = r.logged_in_at;
  }
  return p;
}

export function dismissed(raw: string | null | undefined, now = Date.now()): boolean {
  const t = Date.parse(raw ?? "");
  return Number.isFinite(t) && now - t < DISMISS_DAYS * 86400_000;
}
