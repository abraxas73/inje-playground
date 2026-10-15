import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOLS, DEFAULT_ASSISTANT_MODEL } from "./tools";

export function assistantModel(): string { return process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL; }

// 프롬프트 캐싱: 도구 정의(마지막 도구에 표시) → 고정 규칙(system 첫 블록) → 대화(요청 최상위 자동 캐싱, 도구 왕복 턴마다 앞 대화를 읽음).
const CACHE = { type: "ephemeral" } as const;
const CACHED_TOOLS: Anthropic.Tool[] = ASSISTANT_TOOLS.map((t, i, a) => (i === a.length - 1 ? { ...t, cache_control: CACHE } : t));

/** 한 턴. 생각 끔(between_tools — 이 모델은 "disabled"를 거부), 비스트리밍. max_tokens로 잘리면 오류(반쪽 도구 호출을 앱에 넘기지 않는다). */
export async function callAssistant(messages: Anthropic.MessageParam[], system: Anthropic.TextBlockParam[], deps: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Promise<Anthropic.Message> {
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: deps.model ?? assistantModel(), max_tokens: 4096, system, tools: CACHED_TOOLS, messages,
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
    cache_control: CACHE,
  } as Anthropic.MessageCreateParamsNonStreaming);
  if (msg.stop_reason === "max_tokens") throw new Error("답이 잘렸습니다(max_tokens)");
  return msg;
}

/** 웹 채팅(/api/chat/turn) 한 번의 Claude 호출 — 스트리밍으로 텍스트를 흘리고 완성 메시지를 돌려준다. 도구 정의 마지막에 캐시 표시. */
export const streamAssistant: import("@/lib/chat/engine").StreamFn = async (p, onText, signal) => {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const tools = p.tools.map((t, i, a) => (i === a.length - 1 ? { ...t, cache_control: CACHE } : t));
  const s = client.messages.stream({
    model: p.model, max_tokens: 8192, system: p.system, tools, messages: p.messages,
    ...(p.noTools ? { tool_choice: { type: "none" } } : {}),
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
    cache_control: CACHE,
  } as Anthropic.MessageStreamParams, { signal });
  s.on("text", onText);
  const msg = await s.finalMessage();
  if (msg.stop_reason === "max_tokens") throw new Error("답이 잘렸습니다(max_tokens)");
  return msg;
};
