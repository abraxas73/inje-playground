import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_LLM_MODEL, LlmUnavailableError, splitIntoChunks } from "../extract-llm";
import { dedupeIncoming, FEATURE_NAME_MAX, type IncomingFeature } from "./merge-features";

export const FeatureOutputSchema = z.object({
  features: z.array(z.object({ name: z.string(), description: z.string() })),
});
export type FeatureOutput = z.infer<typeof FeatureOutputSchema>;

/** 청크 텍스트 → 기능 목록. 테스트에서는 가짜 함수를 넣는다. */
export type FeatureExtractCall = (chunk: string) => Promise<FeatureOutput>;

export interface SolutionInfo {
  name: string;
  description: string;
}

export function featureSystemPrompt(solution: SolutionInfo): string {
  return `당신은 당사 솔루션 "${solution.name}"의 제품 문서를 읽고 기능 목록을 정리하는 프리세일즈 분석가입니다.
솔루션 소개: ${solution.description || "(설명 없음)"}

주어진 문서 조각에서 이 솔루션이 제공하는 "기능"을 모두 찾아 아래 형식으로 정리합니다.
- name: 기능 이름. 40자 이내의 명사구(예: "멀티테넌트 IAM", "파이프라인 템플릿"). 문서의 용어를 그대로 씁니다.
- description: 그 기능이 무엇을 해 주는지 1~3문장. 고객 요구사항과 대조할 수 있게 구체적으로 씁니다.
문서에 없는 기능을 만들지 않습니다. 회의록·일정·담당자·이슈 같은 기능이 아닌 내용은 넣지 않습니다.
같은 기능이 여러 표현으로 나오면 하나로 합칩니다. 결과는 스키마에 맞는 JSON만 출력합니다.`;
}

/** 텍스트를 30,000자 청크로 나눠 호출하고 이름 기준으로 합친다(스펙 §3.2). 청크 하나가 실패하면 소스 전체 실패. */
export async function extractFeatures(
  text: string,
  call: FeatureExtractCall,
  opts: { maxChars?: number } = {},
): Promise<{ features: IncomingFeature[]; warnings: string[] }> {
  const chunks = splitIntoChunks(text, opts.maxChars ?? 30000);
  const all: IncomingFeature[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let out: FeatureOutput;
    try {
      out = await call(chunks[i]);
    } catch (e) {
      throw new Error(`기능 추출 실패(청크 ${i + 1}/${chunks.length}): ${e instanceof Error ? e.message : String(e)}`);
    }
    all.push(...out.features.map((f) => ({ name: f.name.slice(0, FEATURE_NAME_MAX), description: f.description })));
  }
  const features = dedupeIncoming(all);
  const warnings: string[] = [];
  if (!features.length) warnings.push("문서에서 기능을 찾지 못했습니다.");
  return { features, warnings };
}

/** Anthropic SDK 호출 함수(1단계 createAnthropicExtractCall과 같은 규약). 키가 없으면 LlmUnavailableError. */
export function createAnthropicFeatureCall(solution: SolutionInfo, opts: { apiKey?: string; model?: string } = {}): FeatureExtractCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  const system = featureSystemPrompt(solution);
  return async (chunk) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: `다음 제품 문서에서 기능 목록을 정리하세요.\n\n${chunk}` }],
      output_config: { format: zodOutputFormat(FeatureOutputSchema) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다.");
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    return FeatureOutputSchema.parse(JSON.parse(text));
  };
}
