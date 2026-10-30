export const DESKTOP_RELEASE_KEY = "desktop_app_release";
export const DESKTOP_BUCKET = "desktop-releases";
export const DESKTOP_PLATFORMS = ["macos", "windows", "linux"] as const;
export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];
export const isDesktopPlatform = (x: unknown): x is DesktopPlatform => DESKTOP_PLATFORMS.includes(x as DesktopPlatform);
/** Linux 업데이트 실패 단계(앱 업데이트 코드와 같게) */
export const LINUX_FAILURE_REASONS = ["download", "length", "signature", "auth", "install", "launch"] as const;
export function desktopFilename(platform: DesktopPlatform, version: string): string {
  if (platform === "macos") return `INNOGRID-macOS-${version}.dmg`;
  if (platform === "windows") return `INNOGRID-Windows-${version}-Setup.exe`;
  return `INNOGRID-Linux-${version}_amd64.deb`;
}
export type DesktopUpdate = { build: number; edSignature: string; minimumOS: string };
export type DesktopArtifact = { version: string; filename: string; path: string; sha256: string; bytes: number; releasedAt: string; update?: DesktopUpdate };
export const DESKTOP_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const MAX_UPDATE_BYTES = 512 * 1024 * 1024;
export function validDesktopUpdate(value: unknown): value is DesktopUpdate {
  if (!value || typeof value !== "object") return false;
  const u = value as DesktopUpdate;
  return Number.isSafeInteger(u.build) && u.build > 0 && typeof u.edSignature === "string" &&
    /^[A-Za-z0-9+/]{86}==$/.test(u.edSignature) &&
    Buffer.from(u.edSignature, "base64").toString("base64") === u.edSignature &&
    typeof u.minimumOS === "string" && /^\d{1,5}\.\d{1,5}(?:\.\d{1,5})?$/.test(u.minimumOS);
}
export type DesktopRelease = Partial<Record<DesktopPlatform, DesktopArtifact>>;
export function parseDesktopRelease(raw: string | null | undefined): DesktopRelease {
  try {
    const data = JSON.parse(raw ?? "{}");
    const result: DesktopRelease = {};
    for (const p of DESKTOP_PLATFORMS) {
      const a = data?.[p];
      if (a && typeof a.version === "string" && typeof a.filename === "string" &&
          DESKTOP_VERSION.test(a.version) && a.filename === desktopFilename(p, a.version) &&
          a.path === `${p}/${a.version}/${a.filename}` && /^[0-9a-f]{64}$/.test(a.sha256) &&
          Number.isSafeInteger(a.bytes) && a.bytes > 0 && typeof a.releasedAt === "string") {
        const { update, ...manual } = a;
        result[p] = { ...manual, ...(validDesktopUpdate(update) ? { update } : {}) };
      }
    }
    return result;
  } catch { return {}; }
}
