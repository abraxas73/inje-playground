import { useRef, type CompositionEvent, type KeyboardEvent } from "react";

/**
 * 채팅 입력창 Enter 전송(Shift+Enter는 줄바꿈). 한글 IME 대응:
 * 조합 중 Enter를 그냥 무시하면 한글로 끝나는 메시지는 Enter가 조합만 끝내고 전송되지 않는다.
 * → 조합이 아직 진행 중이면 "보낼 예정"으로 두고 compositionend에서 보낸다(Chrome·WebView2 순서).
 *   브라우저에 따라 compositionend가 keydown보다 먼저 오면(Safari·WKWebView) 그 자리에서 바로 보낸다.
 * 보낼 값은 상태가 아니라 DOM 값(조합 확정분 포함)을 쓴다.
 */
export function useEnterToSend(send: (value: string) => void) {
  const composing = useRef(false);
  const pending = useRef(false);
  return {
    onCompositionStart() {
      composing.current = true;
    },
    onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
      if (e.key !== "Enter" || e.shiftKey) return;
      if (e.nativeEvent.isComposing && composing.current) { pending.current = true; return; }
      e.preventDefault();
      send(e.currentTarget.value);
    },
    onCompositionEnd(e: CompositionEvent<HTMLTextAreaElement>) {
      composing.current = false;
      if (!pending.current) return;
      pending.current = false;
      send(e.currentTarget.value);
    },
  };
}
