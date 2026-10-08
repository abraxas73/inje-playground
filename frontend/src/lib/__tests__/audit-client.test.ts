import { describe, it, expect } from "vitest";
import { parseAuditClient } from "../audit-client";
import { auditPagePath } from "../audit-page";
import { shouldAuditRequest } from "../audit-proxy";

describe("audit platform", () => {
  it.each([
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1", "iOS", "Safari"],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/130.0 Mobile Safari/537.36", "Android", "Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0", "Windows", "Edge"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18 Safari/605.1", "macOS", "Safari"],
    ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) CriOS/130 Mobile Safari/604.1", "iOS", "Chrome"],
  ])("parses %s", (ua, platform, browser) => {
    expect(parseAuditClient(ua)).toMatchObject({ platform, browser, clientType: "웹 브라우저" });
  });
  it.each([['iOS', 'iOS'], ['macOS', 'macOS'], ['windows', 'Windows'], ['android', 'Android']])("supports native %s", (os, platform) => {
    expect(parseAuditClient(`InnogridApp/1.4.5 (${os}) InnogridBuild/30`)).toMatchObject({platform, clientType: "앱", appVersion: "1.4.5", appBuild: "30", browser: null});
  });
  it("uses declared app OS over a desktop WebView UA and supports old builds", () => {
    expect(parseAuditClient("Mozilla/5.0 (Macintosh) Safari/605.1 InnogridApp/dev (ios)")).toMatchObject({platform: "iOS", clientType: "앱 WebView", appVersion: "dev", appBuild: null});
  });
  it("does not invent missing diagnostics", () => {
    expect(parseAuditClient(null)).toMatchObject({platform: "알 수 없음", browser: null, appVersion: null});
  });
});

describe("page privacy and audit recursion", () => {
  it.each(['/survey/x', '/rfp/shared/secret', '/ppt/s/secret', '/auth/callback', '/login', '//evil.test', '/api/settings'])('omits %s', path => {
    expect(auditPagePath(path)).toBeNull();
  });
  it('drops queries and fragments', () => {
    expect(auditPagePath('/settings?code=secret#private')).toBe('/settings');
    expect(auditPagePath('/home')).toBe('/home');
  });
  it('excludes ingestion, audit reads and anonymous survey reads', () => {
    expect(shouldAuditRequest('POST', '/api/page-views')).toBe(false);
    expect(shouldAuditRequest('GET', '/api/admin/audit')).toBe(false);
    expect(shouldAuditRequest('GET', '/api/rfp/shared/secret')).toBe(false);
    expect(shouldAuditRequest('GET', '/api/ppt/shared/secret')).toBe(false);
    expect(shouldAuditRequest('GET', '/api/surveys/example')).toBe(false);
  });
});
