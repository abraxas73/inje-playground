import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_TOOLS, DEFAULT_ASSISTANT_MODEL } from "./tools";

export function assistantModel(): string { return process.env.ASSISTANT_MODEL || DEFAULT_ASSISTANT_MODEL; }

/** 한 턴. 생각 끔(between_tools — 이 모델은 "disabled"를 거부), 비스트리밍. max_tokens로 잘리면 오류(반쪽 도구 호출을 앱에 넘기지 않는다). */
export async function callAssistant(messages: Anthropic.MessageParam[], system: string, deps: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Promise<Anthropic.Message> {
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model: deps.model ?? assistantModel(), max_tokens: 4096, system, tools: ASSISTANT_TOOLS, messages,
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
  });
  if (msg.stop_reason === "max_tokens") throw new Error("답이 잘렸습니다(max_tokens)");
  return msg;
}
