import type { ChatEvent } from "./events";

/** `data: {...}\n\n` 블록을 이벤트로. 청크 경계가 아무 데서나 잘려도 된다. */
export function createSseParser(onEvent: (e: ChatEvent) => void): (chunk: string) => void {
  let buf = "";
  return (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { onEvent(JSON.parse(data) as ChatEvent); } catch { /* 깨진 블록은 버린다 */ }
    }
  };
}

/** POST /api/chat/turn — 거절(4xx·5xx JSON)은 그 문구로 throw, 성공은 SSE를 끝까지 읽는다. */
export async function postTurn(body: Record<string, unknown>, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "요청이 실패했습니다.");
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  const feed = createSseParser(onEvent);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    feed(value);
  }
}
