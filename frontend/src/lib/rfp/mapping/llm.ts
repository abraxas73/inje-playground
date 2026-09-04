import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, LlmUnavailableError } from "../extract-llm";
import { VERDICTS } from "./types";
import { MAPPING_RULES_PROMPT } from "./prompt";

export const MappingOutputSchema = z.object({
  mappings: z.array(
    z.object({
      reqId: z.string(),
      verdict: z.enum(VERDICTS),
      /** F{n} 별칭. build/na는 null */
      feature: z.string().nullable(),
      rationale: z.string(),
    }),
  ),
});
export type MappingOutput = z.infer<typeof MappingOutputSchema>;

/** 청크 사용자 메시지 → 구조화 출력. 테스트에서는 가짜 함수를 넣는다. */
export type MappingCall = (userMessage: string) => Promise<MappingOutput>;

/**
 * Anthropic SDK 호출 함수. 시스템 블록 1 = 규칙(고정), 블록 2 = 카탈로그(cache_control ephemeral).
 * 모델 claude-opus-5(env RFP_LLM_MODEL), adaptive thinking, 스트리밍 + finalMessage(), zod 구조화 출력.
 * 키가 없으면 LlmUnavailableError.
 */
export function createAnthropicMappingCall(catalogText: string, opts: { apiKey?: string; model?: string } = {}): MappingCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  return async (userMessage) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: MAPPING_RULES_PROMPT },
        { type: "text", text: catalogText, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userMessage }],
      output_config: { format: zodOutputFormat(MappingOutputSchema), effort: "medium" },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다. 청크를 줄이세요.");
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    return MappingOutputSchema.parse(JSON.parse(text));
  };
}
