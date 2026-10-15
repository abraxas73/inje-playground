/** 웹 채팅 턴 API의 SSE 이벤트 — 서버(engine)와 브라우저(sse-client·view)가 같이 쓴다. 서버 모듈을 import하지 않는다. */
export type Location = "server" | "device" | "desktop-relay";
/** target: 서버가 조회한 사람이 읽는 실제 대상(채팅방·공간 이름) — 확인 카드는 이것만 대상으로 보여 준다. */
/** card: 서버가 만든 확인 카드 줄(앱 기능 쓰기 도구) — 있으면 클라이언트는 그대로 보인다. */
export type PendingCall = { id: string; tool: string; input: Record<string, unknown>; location: Location; tier: string; target?: string; card?: string[] };
export type ActionReply = { id: string; approve?: boolean; result?: unknown; isError?: boolean };
export type ChatEvent =
  | { type: "conversation"; id: string }
  | { type: "text"; delta: string }
  | { type: "tool"; id: string; tool: string; location: Location | null; status: "running" | "ok" | "error"; summary?: string }
  | { type: "masked"; count: number }
  | { type: "needs_action"; messageId: string; calls: PendingCall[] }
  | { type: "done"; messageId: string }
  | { type: "error"; message: string; retryable: boolean };
export const sseLine = (e: ChatEvent) => `data: ${JSON.stringify(e)}\n\n`;
