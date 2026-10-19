import { DESKTOP_VERSION, MAX_UPDATE_BYTES, validDesktopUpdate, type DesktopArtifact, type DesktopPlatform } from "./release";

export const UPDATE_ORIGIN = "https://innocrew.innogrid.com";
export const UPDATE_HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export function canAutoUpdate(platform: DesktopPlatform, a: DesktopArtifact): boolean {
  return DESKTOP_VERSION.test(a.version) && validDesktopUpdate(a.update) &&
    Number.isSafeInteger(a.bytes) && a.bytes > 0 && a.bytes <= MAX_UPDATE_BYTES &&
    a.filename.endsWith(platform === "macos" ? ".dmg" : ".exe") &&
    a.path === `${platform}/${a.version}/${a.filename}` &&
    /^INNOGRID-[A-Za-z0-9.+-]+\.(dmg|exe)$/.test(a.filename) &&
    /^[0-9a-f]{64}$/.test(a.sha256) && Number.isFinite(Date.parse(a.releasedAt));
}

const xml = (value: string | number) => String(value).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function createUpdateAppcast(platform: DesktopPlatform, artifact: DesktopArtifact): string {
  if (!canAutoUpdate(platform, artifact)) throw new Error("Invalid update metadata");
  const update = artifact.update!;
  const version = platform === "macos" ? update.build : artifact.version;
  const url = `${UPDATE_ORIGIN}/api/desktop/update/artifact/${platform}/${artifact.version}`;
  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel>
<title>이노크루 업데이트</title><link>${UPDATE_ORIGIN}/apps</link><description>이노크루 데스크톱</description>
<item><title>이노크루 ${xml(artifact.version)}</title><pubDate>${xml(new Date(artifact.releasedAt).toUTCString())}</pubDate>
<sparkle:version>${xml(version)}</sparkle:version><sparkle:shortVersionString>${xml(artifact.version)}</sparkle:shortVersionString>
<sparkle:minimumSystemVersion>${xml(update.minimumOS)}</sparkle:minimumSystemVersion>
<enclosure url="${xml(url)}" sparkle:os="${platform === "macos" ? "macos" : "windows"}" sparkle:version="${xml(version)}" sparkle:shortVersionString="${xml(artifact.version)}" sparkle:edSignature="${xml(update.edSignature)}" length="${artifact.bytes}" type="application/octet-stream" />
</item></channel></rss>`;
}
