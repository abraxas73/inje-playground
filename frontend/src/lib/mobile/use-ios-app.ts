"use client";

import { useSyncExternalStore } from "react";
import { isIosAppUA } from "@/lib/mobile/app-ua";

const noSubscribe = () => () => {};
/** iOS 앱 WebView인지 — 하이드레이션 안전(서버 렌더는 false). */
export function useIosApp(): boolean {
  return useSyncExternalStore(noSubscribe, () => isIosAppUA(navigator.userAgent), () => false);
}
