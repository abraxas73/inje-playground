/** settings 키 `mobile_release`(문자열 JSON) ↔ GET /api/mobile/release 응답. 쓰는 쪽은 릴리스 스크립트(mobile/scripts/release-mobile.sh)뿐. */
export const MOBILE_RELEASE_KEY = "mobile_release";
export const MOBILE_BUCKET = "mobile";
export const APK_URL_TTL_SECONDS = 600;

export type PlatformRelease = { version: string; build: number; releasedAt: string | null };
export type AndroidRelease = PlatformRelease & { apkPath: string };
export type MobileRelease = { notes: string; testflightUrl: string | null; android: AndroidRelease | null; ios: PlatformRelease | null };
export type ReleaseResponse = {
  notes: string;
  ios: (PlatformRelease & { url: string | null }) | null;
  android: (PlatformRelease & { url: string | null }) | null;
};

const EMPTY: MobileRelease = { notes: "", testflightUrl: null, android: null, ios: null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
function buildNo(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
function platform(v: unknown): PlatformRelease | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const version = str(o.version);
  const build = buildNo(o.build);
  if (!version || build === null) return null;
  return { version, build, releasedAt: str(o.releasedAt) };
}

/** 관대한 파싱: 없음·깨진 JSON·형식 오류는 빈 값. 플랫폼 블록은 version·양의 정수 build가 있어야 산다(android는 apkPath도). */
export function parseMobileRelease(raw: string | undefined | null): MobileRelease {
  if (!raw) return EMPTY;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return EMPTY; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return EMPTY;
  const o = j as Record<string, unknown>;
  const a = platform(o.android);
  const apkPath = a ? str((o.android as Record<string, unknown>).apkPath) : null;
  return {
    notes: typeof o.notes === "string" ? o.notes : "",
    testflightUrl: str(o.testflightUrl),
    android: a && apkPath ? { ...a, apkPath } : null,
    ios: platform(o.ios),
  };
}

export function releaseResponse(rel: MobileRelease, apkUrl: string | null): ReleaseResponse {
  return {
    notes: rel.notes,
    ios: rel.ios ? { ...rel.ios, url: rel.testflightUrl } : null,
    android: rel.android ? { version: rel.android.version, build: rel.android.build, releasedAt: rel.android.releasedAt, url: apkUrl } : null,
  };
}
