import Anthropic from "@anthropic-ai/sdk";
import { briefingSystemPrompt, DEFAULT_BRIEFING_MODEL, type BriefingPayload } from "./briefing";

export function briefingModel(): string { return process.env.MOBILE_BRIEFING_MODEL || DEFAULT_BRIEFING_MODEL; }

/**
 * 비스트리밍 한 번, 생각 끔. Sonnet 5.5는 생각이 기본으로 켜져 있어 max_tokens 400을 생각이 먼저 쓰고 문장이 중간에 잘렸다(2026-10-04 실측).
 * 이 모델에서 생각을 끄는 값은 {type:"between_tools"}(API가 "disabled"를 거부하며 안내). SDK 타입에 아직 없어 단언한다.
 * max_tokens로 잘리거나 비면 오류 — 라우트가 502를 주고 앱은 기존 문장·격언을 유지한다.
 */
export async function generateBriefing(p: BriefingPayload, deps: { client?: Pick<Anthropic, "messages">; model?: string } = {}): Promise<{ text: string; model: string }> {
  const model = deps.model ?? briefingModel();
  const client = deps.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await client.messages.create({
    model, max_tokens: 400, system: briefingSystemPrompt(), messages: [{ role: "user", content: JSON.stringify({ ...p, jira: [] }) }],
    thinking: { type: "between_tools" } as unknown as Anthropic.Messages.ThinkingConfigParam,
  });
  const text = msg.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("").trim();
  if (msg.stop_reason === "max_tokens") throw new Error("브리핑 문장이 잘림(max_tokens)");
  if (!text) throw new Error("브리핑 문장이 비었습니다");
  return { text, model };
}
