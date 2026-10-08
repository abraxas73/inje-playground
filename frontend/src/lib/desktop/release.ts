export const DESKTOP_RELEASE_KEY = "desktop_app_release";
export const DESKTOP_BUCKET = "desktop-releases";
export type DesktopPlatform = "macos" | "windows";
export type DesktopArtifact = { version: string; filename: string; path: string; sha256: string; bytes: number; releasedAt: string };
export type DesktopRelease = Partial<Record<DesktopPlatform, DesktopArtifact>>;
export function parseDesktopRelease(raw: string | null | undefined): DesktopRelease {
  try {
    const data = JSON.parse(raw ?? "{}");
    const result: DesktopRelease = {};
    for (const p of ["macos", "windows"] as const) {
      const a = data?.[p];
      if (a && typeof a.version === "string" && typeof a.filename === "string" &&
          /^INNOGRID-[A-Za-z0-9.+-]+\.(dmg|exe)$/.test(a.filename) &&
          a.path === `${p}/${a.version}/${a.filename}` && /^[0-9a-f]{64}$/.test(a.sha256) &&
          Number.isSafeInteger(a.bytes) && a.bytes > 0 && typeof a.releasedAt === "string") result[p] = a;
    }
    return result;
  } catch { return {}; }
}
