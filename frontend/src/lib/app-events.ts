/**
 * 앱 이벤트(POST /api/app/events) — 정해진 kind·code만 받는다. 메시지·스택·URL·아마란스 값은 받지 않는다.
 * 앱 쪽 목록은 mobile/lib/telemetry/app_events.dart와 같게 유지한다.
 */

/** kind → 허용 code. app_error는 예외 **타입 이름**이라 집합 대신 형식으로 검사한다. */
export const APP_EVENT_CODES = {
  /** 아마란스 자동 로그인 실패 — 입력칸·버튼 못 찾음, 워치독(12초), 오류 문구, OTP, 쿠키 검증 실패 */
  gw_login_failed: ["no_field", "no_button", "watchdog", "reveal_error", "otp", "verify_failed"],
  /** 아마란스 API 401이 세션 재확인(gw050A02)에서도 401 */
  gw_unauthorized: ["session_expired"],
  app_error: null,
} as const satisfies Record<string, readonly string[] | null>;

export type AppEventKind = keyof typeof APP_EVENT_CODES;
export type AppEvent = { kind: AppEventKind; code: string; version: string; platform: string; at: string | null };

export const APP_EVENT_ACTION: Record<AppEventKind, string> = {
  gw_login_failed: "아마란스 자동 로그인 실패",
  gw_unauthorized: "아마란스 세션 만료",
  app_error: "앱 오류",
};

export const MAX_EVENTS = 20;
const TYPE_NAME = /^[A-Za-z_$][\w$<>,.? ]{0,79}$/;
const VERSION = /^(\d{1,4}\.\d{1,4}\.\d{1,4}|dev)$/;
/** Flutter defaultTargetPlatform.name */
const PLATFORMS = new Set(["android", "iOS", "macOS", "windows", "linux", "fuchsia"]);

function parseOne(v: unknown): AppEvent | null {
  if (!v || typeof v !== "object") return null;
  const e = v as Record<string, unknown>;
  if (typeof e.kind !== "string" || !Object.hasOwn(APP_EVENT_CODES, e.kind)) return null;
  const kind = e.kind as AppEventKind;
  const allowed = APP_EVENT_CODES[kind];
  if (typeof e.code !== "string" || !(allowed ? (allowed as readonly string[]).includes(e.code) : TYPE_NAME.test(e.code))) return null;
  if (typeof e.version !== "string" || !VERSION.test(e.version)) return null;
  if (typeof e.platform !== "string" || !PLATFORMS.has(e.platform)) return null;
  let at: string | null = null;
  if (e.at !== undefined) {
    const t = typeof e.at === "string" && e.at.length <= 40 ? Date.parse(e.at) : NaN;
    if (Number.isNaN(t)) return null;
    at = new Date(t).toISOString();
  }
  return { kind, code: e.code, version: e.version, platform: e.platform, at };
}

/** 본문 {events:[…]} → 이벤트 목록. 하나라도 틀리거나 1~20개가 아니면 null(400). */
export function parseAppEvents(body: unknown): AppEvent[] | null {
  const list = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_EVENTS) return null;
  const out = list.map(parseOne);
  return out.every((e): e is AppEvent => e !== null) ? out : null;
}

/** 로그인 페이지 변경을 의심할 사유 — 오류 문구(비밀번호 틀림)·OTP는 사람 쪽 일이라 알림 판단에서 뺀다. */
export const GW_ALERT_CODES = new Set(["no_field", "no_button", "watchdog", "verify_failed"]);
export const GW_ALERT_WINDOW_MS = 60 * 60_000;
export const GW_ALERT_COOLDOWN_MS = 6 * 60 * 60_000;
export const APP_EVENT_ALERTS_KEY = "app_event_alerts";

/**
 * 최근 1시간의 gw_login_failed 행 → 운영자 알림 문구(보낼 때만). 의심 사유를 보고한 사용자가 2명 이상이고
 * 마지막 알림이 6시간 넘었을 때만.
 */
export function gwAlertText(rows: { user_id: string | null; detail: { code?: unknown } | null }[], lastAlertAt: string | undefined, now: number): string | null {
  const users = new Set(rows.filter((r) => r.user_id && GW_ALERT_CODES.has(String(r.detail?.code))).map((r) => r.user_id));
  if (users.size < 2) return null;
  if (lastAlertAt && now - Date.parse(lastAlertAt) < GW_ALERT_COOLDOWN_MS) return null;
  const dist = new Map<string, number>();
  for (const r of rows) {
    const c = String(r.detail?.code ?? "?");
    dist.set(c, (dist.get(c) ?? 0) + 1);
  }
  const codes = [...dist].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ");
  return `아마란스 자동 로그인 실패가 여러 사용자에게서 보고됨 — 로그인 페이지 변경 가능성\n최근 1시간 ${rows.length}건 · 사용자 ${users.size}명\n사유: ${codes}`;
}
