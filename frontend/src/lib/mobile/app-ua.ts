import type { MemberSourceProvider } from "@/lib/providers";

/** 모바일 앱 WebView는 User-Agent 끝에 `InnogridApp/<버전> (<platform>)`을 붙인다(mobile/lib/web/web_screen.dart). */
export function isInnogridAppUA(ua: string): boolean {
  return /\bInnogridApp\//.test(ua);
}

export function isInnogridApp(): boolean {
  return typeof navigator !== "undefined" && isInnogridAppUA(navigator.userAgent);
}

/**
 * "가져오기" 버튼의 동작. Dooray 모드는 브라우저가 Dooray API를 직접 부르며 사내 VPN + Chrome 확장(CORS)이 필요하다 —
 * 앱 WebView에는 둘 다 없으므로 직접 호출을 건너뛰고 저장된 명단(dooray_members 캐시)만 쓴다.
 */
export function doorayImportMode(memberSource: MemberSourceProvider, isApp: boolean): "picker" | "dooray" | "app-cached" {
  if (memberSource !== "dooray") return "picker";
  return isApp ? "app-cached" : "dooray";
}

export const APP_DOORAY_NOTICE = "앱에서는 Dooray에서 직접 가져올 수 없습니다(사내 VPN·Chrome 확장 필요). 사내 VPN이 연결된 PC 웹에서 가져오면 그 명단을 앱에서도 씁니다.";
