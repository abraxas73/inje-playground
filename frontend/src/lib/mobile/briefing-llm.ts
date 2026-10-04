import Anthropic from "@anthropic-ai/sdk";
import { briefingSystemPrompt, DEFAULT_BRIEFING_MODEL, type BriefingPayload } from "./briefing";

export function briefingModel(): string { return process.env.MOBILE_BRIEFING_MODEL || DEFAULT_BRIEFING_MODEL; }

/** 비스트리밍 한 번. thinking은 쓰지 않는다(짧은 요약, 지연 최소). max_tokens에 잘려도 받은 데까지 쓴다. */
export async function generateBriefing(p: BriefingPayload, deps: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Promise<{ text: string; model: string }> {
  const model = deps.model ?? briefingModel();
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({ model, max_tokens: 400, system: briefingSystemPrompt(), messages: [{ role: "user", content: JSON.stringify(p) }] });
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  return { text, model };
}
