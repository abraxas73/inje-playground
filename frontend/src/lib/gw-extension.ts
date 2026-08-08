export function requestGwSession(timeoutMs = 8000): Promise<{ oAuthToken: string; signKey: string; email: string }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("GW 로그인 확장 프로그램이 응답하지 않습니다. 확장 설치를 확인해주세요."));
    }, timeoutMs);

    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timeout);
    }
    function handler(event: MessageEvent) {
      const d = event.data;
      if (event.source !== window || !d || d.source !== "gw-bridge-ext" || d.type !== "GW_SESSION_RESPONSE" || d.id !== id) return;
      cleanup();
      if (d.error) reject(new Error(d.error));
      else if (d.data?.oAuthToken && d.data?.signKey && d.data?.email) resolve(d.data);
      else reject(new Error("GW 세션 정보를 받지 못했습니다."));
    }

    window.addEventListener("message", handler);
    window.postMessage({ source: "gw-bridge", type: "GW_SESSION_REQUEST", id }, window.location.origin);
  });
}
