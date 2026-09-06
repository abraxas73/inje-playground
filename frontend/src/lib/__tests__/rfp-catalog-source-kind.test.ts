import { describe, it, expect } from "vitest";
import { detectSourceKind } from "@/lib/rfp/catalog/source-kind";

const HOST = "pms-innogrid.atlassian.net";

describe("detectSourceKind", () => {
  it("Confluence 호스트는 confluence, *.sharepoint.com은 xlsx", () => {
    expect(detectSourceKind(`https://${HOST}/wiki/spaces/A/pages/1/제목`, HOST)).toBe("confluence");
    expect(detectSourceKind(`https://PMS-INNOGRID.atlassian.net/wiki/pages/1`, HOST)).toBe("confluence");
    expect(detectSourceKind("https://innogridoffice.sharepoint.com/:x:/s/PQS/IQCEW08", HOST)).toBe("xlsx");
    expect(detectSourceKind("https://innogridoffice-my.sharepoint.com/:x:/p/a/b", null)).toBe("xlsx");
  });
  it("그 외 호스트·http·잘못된 URL·confluenceHost 없음은 null", () => {
    expect(detectSourceKind("https://example.com/x", HOST)).toBeNull();
    expect(detectSourceKind(`http://${HOST}/wiki/pages/1`, HOST)).toBeNull();
    expect(detectSourceKind("https://evil.sharepoint.com.attacker.io/x", HOST)).toBeNull();
    expect(detectSourceKind("not a url", HOST)).toBeNull();
    expect(detectSourceKind(`https://${HOST}/wiki/pages/1`, null)).toBeNull();
  });
});
