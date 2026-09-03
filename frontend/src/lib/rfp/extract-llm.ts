import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { documentText, type DocumentModel } from "./document-model";
import { categoryCodeFromName, parseReqId, type Requirement } from "./requirements";
import type { ExtractionResult } from "./extract-standard";

export const LlmRequirementSchema = z.object({
  categoryName: z.string(),
  reqId: z.string().nullable(),
  title: z.string(),
  definition: z.string(),
  details: z.string(),
  deliverables: z.string(),
  related: z.string(),
});
export const LlmOutputSchema = z.object({ requirements: z.array(LlmRequirementSchema) });
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

/** 청크 텍스트 → 구조화 결과. 테스트에서는 가짜 함수를 넣는다. */
export type LlmExtractCall = (chunk: string) => Promise<LlmOutput>;

export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export const DEFAULT_LLM_MODEL = "claude-opus-5";

const SYSTEM_PROMPT = `당신은 공공 정보화 사업 제안요청서(RFP)에서 요구사항을 추출하는 분석가입니다.
주어진 문서 조각에서 "요구사항" 항목을 모두 찾아 아래 필드로 정리합니다.
- categoryName: 요구사항 분류(예: 서비스 요구사항, 기능 요구사항, 보안 요구사항). 문서에 없으면 내용으로 판단합니다.
- reqId: 문서에 적힌 요구사항 ID(예: SER-001). 없으면 null.
- title: 요구사항 명칭.
- definition: 정의(한두 문장). 없으면 빈 문자열.
- details: 세부 내용. 문서의 문장·글머리 기호를 그대로 옮기고 요약하지 않습니다. 표는 "[a | b | c]" 줄로 씁니다.
- deliverables: 산출정보(산출물). 없으면 빈 문자열.
- related: 관련 요구사항 ID와 이름. 없으면 빈 문자열.
요구사항이 아닌 안내문·평가 방법·서식은 넣지 않습니다. 결과는 스키마에 맞는 JSON만 출력합니다.`;

/**
 * 문서 텍스트를 maxChars 이하 청크로 나눈다. 줄은 자르지 않고, 60% 이상 찼으면 "요구사항" 제목 줄에서 끊는다.
 */
export function splitIntoChunks(text: string, maxChars = 30000): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let len = 0;
  const flush = () => {
    if (cur.length) {
      chunks.push(cur.join("\n"));
      cur = [];
      len = 0;
    }
  };
  for (const line of text.split("\n")) {
    const isHeading = /요구사항/.test(line) && line.length < 60 && !line.startsWith("|");
    if ((isHeading && len > maxChars * 0.6) || (cur.length && len + line.length + 1 > maxChars)) flush();
    cur.push(line);
    len += line.length + 1;
  }
  flush();
  return chunks;
}

/** 표준 양식이 아닌 문서를 LLM으로 추출. 청크별 호출 → 병합(ID 중복은 먼저 나온 것) → ID 없는 항목은 구분 코드로 번호 부여. */
export async function extractWithLlm(doc: DocumentModel, call: LlmExtractCall, opts: { maxChars?: number } = {}): Promise<ExtractionResult> {
  const chunks = splitIntoChunks(documentText(doc), opts.maxChars);
  const requirements: Requirement[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const counters = new Map<string, number>();

  for (let i = 0; i < chunks.length; i++) {
    let out: LlmOutput;
    try {
      out = await call(chunks[i]);
    } catch (e) {
      throw new Error(`LLM 추출 실패(청크 ${i + 1}/${chunks.length}): ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const r of out.requirements) {
      const parsed = r.reqId ? parseReqId(r.reqId) : null;
      const code = parsed?.code ?? categoryCodeFromName(r.categoryName);
      let reqId = parsed ? r.reqId!.replace(/\s+/g, "").toUpperCase() : "";
      if (!reqId) {
        do {
          const n = (counters.get(code) ?? 0) + 1;
          counters.set(code, n);
          reqId = `${code}-${String(n).padStart(3, "0")}`;
        } while (seen.has(reqId));
      }
      if (seen.has(reqId)) {
        warnings.push(`중복 요구사항 ID ${reqId}: 먼저 나온 항목만 사용`);
        continue;
      }
      seen.add(reqId);
      requirements.push({
        categoryCode: code,
        categoryName: r.categoryName.trim() || code,
        reqId,
        title: r.title.trim(),
        definition: r.definition.trim(),
        details: r.details.trim(),
        deliverables: r.deliverables.trim(),
        related: r.related.trim(),
        sortOrder: requirements.length,
        source: { llm: true },
      });
    }
  }
  if (!requirements.length) warnings.push("LLM이 요구사항을 하나도 찾지 못했습니다.");
  return { requirements, warnings, method: "llm" };
}

/**
 * Anthropic SDK 호출 함수. 모델 claude-opus-5(env RFP_LLM_MODEL), adaptive thinking, 스트리밍 + finalMessage(),
 * 구조화 출력(output_config.format). 키가 없으면 LlmUnavailableError.
 */
export function createAnthropicExtractCall(opts: { apiKey?: string; model?: string } = {}): LlmExtractCall {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new LlmUnavailableError("ANTHROPIC_API_KEY가 설정되지 않았습니다.");
  const model = opts.model ?? process.env.RFP_LLM_MODEL ?? DEFAULT_LLM_MODEL;
  const client = new Anthropic({ apiKey });
  return async (chunk) => {
    const stream = client.messages.stream({
      model,
      max_tokens: 64000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `다음 제안요청서 본문에서 요구사항을 추출하세요.\n\n${chunk}` }],
      output_config: { format: zodOutputFormat(LlmOutputSchema) },
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new Error("모델이 요청을 거부했습니다.");
    if (msg.stop_reason === "max_tokens") throw new Error("출력이 max_tokens에 잘렸습니다. 청크를 줄이세요.");
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as Anthropic.TextBlock).text)
      .join("");
    return LlmOutputSchema.parse(JSON.parse(text));
  };
}
