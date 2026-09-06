import type { RfpSourceKind } from "@/types/rfp";

/**
 * 소스 URL의 종류(4단계 스펙 §4.1). https만. Confluence 호스트(ATLASSIAN_SITE)와 같으면 confluence,
 * *.sharepoint.com이면 xlsx, 그 외 null. confluenceHost가 null(env 미설정)이면 sharepoint만 본다.
 */
export function detectSourceKind(url: string, confluenceHost: string | null): RfpSourceKind | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (confluenceHost && u.host.toLowerCase() === confluenceHost.toLowerCase()) return "confluence";
  if (/(^|\.)sharepoint\.com$/i.test(u.hostname)) return "xlsx";
  return null;
}
