"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface MsCallbackHandlers {
  onConnected?: () => void;
  onError?: (message: string) => void;
}

/**
 * /api/ms/callback이 붙여 돌려보내는 ?ms_connected=1 · ?ms_error=<문구> 를 마운트 뒤 한 번 읽어 콜백을 부르고, 주소에서 지운다.
 * useSearchParams는 정적 페이지에서 Suspense 경계를 요구하므로 window.location을 쓴다. 한 번 처리한 뒤에는(router.replace가 끝나기 전 재렌더가 있어도) 다시 부르지 않는다.
 */
export function useMsCallbackQuery(handlers: MsCallbackHandlers): void {
  const router = useRouter();
  const handlersRef = useRef<MsCallbackHandlers>(handlers);
  const doneRef = useRef(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const t = setTimeout(() => {
      if (doneRef.current) return;
      const sp = new URLSearchParams(window.location.search);
      const connected = sp.get("ms_connected") === "1";
      const error = sp.get("ms_error");
      if (!connected && !error) return;
      doneRef.current = true;
      if (connected) handlersRef.current.onConnected?.();
      if (error) handlersRef.current.onError?.(error);
      sp.delete("ms_connected");
      sp.delete("ms_error");
      const qs = sp.toString();
      router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }, 0);
    return () => clearTimeout(t);
  }, [router]);
}
