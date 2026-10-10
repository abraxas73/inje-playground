import type { DesktopPlatform } from "./release";

/** 홈 설치 카드 "다음에" 저장 키(localStorage, ISO 시각) — 브라우저 단위로 30일 숨김 */
export const DISMISS_KEY = "desktop_app_card_dismissed_at";
export const DISMISS_DAYS = 30;

export type Presence = Record<DesktopPlatform, string | null>;

/** 앱 로그인 User-Agent `InnogridApp/<ver> (<platform>) InnogridBuild/<n>`(mobile/lib/config.dart) → 데스크톱 플랫폼 */
export function appPlatform(ua: string | null | undefined): DesktopPlatform | null {
  const m = /^InnogridApp\/\S+ \((macos|windows)\)/.exec(ua ?? "");
  return m ? (m[1] as DesktopPlatform) : null;
}

/** 브라우저 UA → 데스크톱 OS. 모바일·태블릿은 null. iPadOS Safari는 Macintosh로 위장하므로 터치 지점 수로 거른다. */
export function browserPlatform(ua: string, maxTouchPoints = 0): DesktopPlatform | null {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return null;
  if (/Windows NT/.test(ua)) return "windows";
  if (/Macintosh/.test(ua) && maxTouchPoints < 2) return "macos";
  return null;
}

/** login_history 행(최신순) → 플랫폼별 가장 최근 앱 로그인 시각 */
export function presenceFromRows(rows: { user_agent: string | null; logged_in_at: string }[]): Presence {
  const p: Presence = { macos: null, windows: null };
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
