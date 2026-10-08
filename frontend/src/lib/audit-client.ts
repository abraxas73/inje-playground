/** Request-provided diagnostics, never an authorization signal. Old rows are parsed too. */
export interface AuditClient {
  platform: string;
  clientType: string;
  appVersion: string | null;
  appBuild: string | null;
  browser: string | null;
}

export function parseAuditClient(userAgent: string | null): AuditClient {
  const ua = userAgent ?? "";
  const app = /InnogridApp\/([^\s;()]+)\s*\(([^)]+)\)/i.exec(ua);
  const explicit = app?.[2].split(";")[0].trim().toLowerCase();
  const platforms: Record<string, string> = { windows: "Windows", macos: "macOS", ios: "iOS", android: "Android", linux: "Linux" };
  // iOS must precede Mac OS X; Android must precede Linux.
  const platform = (explicit && platforms[explicit]) ||
    (/iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Android/i.test(ua) ? "Android" :
      /Windows/i.test(ua) ? "Windows" : /Macintosh|Mac OS X/i.test(ua) ? "macOS" :
        /Linux/i.test(ua) ? "Linux" : "알 수 없음");
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua) ? "Edge" : /(?:OPR|OPiOS)\//i.test(ua) ? "Opera" :
    /SamsungBrowser\//i.test(ua) ? "Samsung Internet" : /(?:Chrome|CriOS)\//i.test(ua) ? "Chrome" :
      /(?:Firefox|FxiOS)\//i.test(ua) ? "Firefox" : /Safari\//i.test(ua) ? "Safari" : null;
  return {
    platform,
    clientType: app ? (/Mozilla\//i.test(ua) ? "앱 WebView" : "앱") : browser ? "웹 브라우저" : "알 수 없음",
    appVersion: app?.[1] ?? null,
    appBuild: /InnogridBuild\/(\d+)/i.exec(ua)?.[1] ?? null,
    browser,
  };
}

/** Fixed PostgREST expressions; platform input never enters a filter directly. */
export const AUDIT_PLATFORMS = ["Windows", "macOS", "iOS", "Android", "Linux"] as const;
export function auditPlatformFilter(platform: string | null): string | null {
  const native: Record<string, string> = { Windows: "windows", macOS: "macos", iOS: "ios", Android: "android", Linux: "linux" };
  if (!platform || !Object.hasOwn(native, platform)) return null;
  const ua = (pattern: string) => `user_agent.ilike."*${pattern}*"`;
  const not = (pattern: string) => `user_agent.not.ilike."*${pattern}*"`;
  const browser: Record<string, string> = {
    Windows: ua("Windows"),
    macOS: `and(or(${ua("Macintosh")},${ua("Mac OS X")}),${not("iPhone")},${not("iPad")},${not("iPod")})`,
    iOS: `or(${ua("iPhone")},${ua("iPad")},${ua("iPod")})`,
    Android: ua("Android"),
    Linux: `and(${ua("Linux")},${not("Android")})`,
  };
  return `${ua(`InnogridApp/* (${native[platform]})`)},and(${not("InnogridApp/")},${browser[platform]})`;
}
