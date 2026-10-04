import { describe, expect, it } from "vitest";
import { parseMobileRelease, releaseResponse } from "@/lib/mobile/release";

const full = JSON.stringify({ notes: "게시판", testflightUrl: "https://testflight.apple.com/join/abc", android: { version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk", releasedAt: "2026-10-04T06:00:00Z" }, ios: { version: "1.1.0", build: "3", releasedAt: "2026-10-04T06:30:00Z" } });

describe("parseMobileRelease", () => {
  it("정상 — build는 정수·정수 문자열 모두 받는다", () => {
    const r = parseMobileRelease(full);
    expect(r.android).toEqual({ version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk", releasedAt: "2026-10-04T06:00:00Z" });
    expect(r.ios).toEqual({ version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:30:00Z" });
    expect(r.testflightUrl).toBe("https://testflight.apple.com/join/abc");
    expect(r.notes).toBe("게시판");
  });
  it.each([undefined, "", "{broken", "[]", "null"])("없음·깨짐(%s)은 빈 값", (raw) => {
    expect(parseMobileRelease(raw)).toEqual({ notes: "", testflightUrl: null, android: null, ios: null });
  });
  it("플랫폼 블록은 version·양의 정수 build가 있어야 산다 — android는 apkPath도", () => {
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: 0, apkPath: "a" } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: -2, apkPath: "a" } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: 2 } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ ios: { version: "1.0.0", build: 2 } })).ios).toEqual({ version: "1.0.0", build: 2, releasedAt: null });
    expect(parseMobileRelease(JSON.stringify({ ios: { version: "1.0.0", build: 2 } })).android).toBeNull();
  });
});

describe("releaseResponse", () => {
  it("ios.url은 testflightUrl, android.url은 넘겨준 서명 URL — 없으면 null", () => {
    const r = parseMobileRelease(full);
    expect(releaseResponse(r, "https://signed").android).toEqual({ version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:00:00Z", url: "https://signed" });
    expect(releaseResponse(r, null).android?.url).toBeNull();
    expect(releaseResponse(r, null).ios?.url).toBe("https://testflight.apple.com/join/abc");
    expect(releaseResponse({ ...r, testflightUrl: null }, null).ios?.url).toBeNull();
    expect(releaseResponse({ ...r, ios: null, android: null }, null)).toEqual({ notes: "게시판", ios: null, android: null });
  });
});
