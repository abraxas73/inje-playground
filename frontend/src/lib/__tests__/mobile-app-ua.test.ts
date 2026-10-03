import { describe, expect, it } from "vitest";
import { isInnogridAppUA, doorayImportMode } from "@/lib/mobile/app-ua";

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
