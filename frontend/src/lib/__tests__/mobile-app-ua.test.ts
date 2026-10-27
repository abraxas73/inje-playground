import { describe, expect, it } from "vitest";
import { isInnogridAppUA, isIosAppUA, doorayImportMode } from "@/lib/mobile/app-ua";
import { manualSections, withoutAndroid } from "@/lib/manual/sections";

describe("isInnogridAppUA", () => {
  it("모바일 앱 WebView의 User-Agent(InnogridApp/<버전>)만 참", () => {
    expect(isInnogridAppUA("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 InnogridApp/1.0.0 (ios)")).toBe(true);
    expect(isInnogridAppUA("Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile InnogridApp/1.0.0 (android)")).toBe(true);
    expect(isInnogridAppUA("Mozilla/5.0 (Macintosh) Chrome/120 Safari/537.36")).toBe(false);
    expect(isInnogridAppUA("")).toBe(false);
  });
});

describe("doorayImportMode", () => {
  it("Dooray 모드 + 앱이면 직접 호출을 건너뛰고 저장된 명단만 쓴다(사내 VPN·Chrome 확장 없음)", () => {
    expect(doorayImportMode("dooray", true)).toBe("app-cached");
    expect(doorayImportMode("dooray", false)).toBe("dooray");
    expect(doorayImportMode("users", true)).toBe("picker");
    expect(doorayImportMode("teams", false)).toBe("picker");
  });
});

describe("iOS 앱에서 Android 안내 숨김(App Store 2.3.10)", () => {
  it("iOS 앱 WebView만 참", () => {
    expect(isIosAppUA("Mozilla/5.0 (iPhone) Mobile/15E148 InnogridApp/1.7.70 (ios)")).toBe(true);
    expect(isIosAppUA("Mozilla/5.0 (Linux; Android 14) InnogridApp/1.7.70 (android)")).toBe(false);
    expect(isIosAppUA("Mozilla/5.0 (Macintosh) InnogridApp/1.7.70 (macos)")).toBe(false);
    expect(isIosAppUA("Mozilla/5.0 (iPhone) Safari/605.1")).toBe(false);
  });
  it("매뉴얼에서 Android·Google Play 절을 뺀다", () => {
    const left = withoutAndroid(manualSections);
    expect(left.length).toBeGreaterThan(0);
    expect(left.length).toBeLessThan(manualSections.length);
    expect(JSON.stringify(left)).not.toMatch(/Android|Google Play|APK/);
  });
});
