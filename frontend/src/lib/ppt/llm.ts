/** Anthropic 호출을 한 겹 싼다 — 테스트에서 가짜로 바꾸고, usage(캐시 포함)를 한 곳에서 집계한다. */
import Anthropic from "@anthropic-ai/sdk";

export const DEFAULT_PPT_MODEL = "claude-sonnet-5-5";
export function pptModel(): string { return process.env.PPT_LLM_MODEL || DEFAULT_PPT_MODEL; }

export interface LlmUsage { in: number; out: number; cacheRead: number; cacheWrite: number }
export const ZERO_USAGE: LlmUsage = { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 };
export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return { in: a.in + b.in, out: a.out + b.out, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite };
}
export interface LlmReply { text: string; usage: LlmUsage; stopReason: string | null }
export interface DeckLlm {
  readonly model: string;
  complete(system: Anthropic.TextBlockParam[], messages: Anthropic.MessageParam[]): Promise<LlmReply>;
}
export class LlmUnavailableError extends Error { constructor(m = "ANTHROPIC_API_KEY가 설정되지 않았습니다.") { super(m); this.name = "LlmUnavailableError"; } }

const MAX_TOKENS = 16_000;

export function createAnthropicDeckLlm(opts: { apiKey?: string; model?: string } = {}): DeckLlm {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError();
  const model = opts.model ?? pptModel();
  const client = new Anthropic({ apiKey });
  return {
    model,
    async complete(system, messages) {
      const stream = client.messages.stream({ model, max_tokens: MAX_TOKENS, thinking: { type: "adaptive" }, system, messages });
      const msg = await stream.finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
      if (msg.stop_reason === "max_tokens") throw new Error("모델 출력이 max_tokens(16000)에 잘렸습니다. 원고를 줄이거나 장 수를 줄여 다시 시도하세요.");
      const text = msg.content.filter((b) => b.type === "text").map((b) => (b as Anthropic.TextBlock).text).join("");
      const u = msg.usage;
      return {
        text, stopReason: msg.stop_reason,
        usage: { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      };
    },
  };
}
