// @vitest-environment node
// 이 스위트는 서버 전용 모듈(Anthropic 클라이언트 생성)을 다룬다. 프로젝트 기본 jsdom 환경에서는
// SDK의 브라우저 감지(window/document/navigator 존재)가 오탐하여 dangerouslyAllowBrowser 없이도
// "browser-like environment" 오류를 던지므로, 이 파일만 Node 환경으로 돌린다(설계 변경 아님).
import { describe, it, expect, vi, afterEach } from "vitest";
import { splitIntoChunks, extractWithLlm, createAnthropicExtractCall, LlmUnavailableError, LlmOutputSchema, type LlmOutput } from "@/lib/rfp/extract-llm";
import type { DocumentModel } from "@/lib/rfp/document-model";

afterEach(() => vi.unstubAllEnvs());

describe("splitIntoChunks", () => {
  it("짧은 문서는 청크 하나", () => {
    expect(splitIntoChunks("a\nb\nc")).toEqual(["a\nb\nc"]);
  });
  it("최대 길이를 넘지 않게 나누고 줄을 자르지 않는다", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `줄 ${i} ${"x".repeat(400)}`);
    const chunks = splitIntoChunks(lines.join("\n"), 10000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10000);
    expect(chunks.join("\n").split("\n")).toHaveLength(100);
  });
  it("충분히 찼으면 '요구사항' 제목 줄에서 끊는다", () => {
    const body = Array.from({ length: 30 }, (_, i) => `내용 ${i} ${"y".repeat(100)}`).join("\n");
    const text = `${body}\n2. 기능 요구사항\n${body}`;
    const chunks = splitIntoChunks(text, 5000);
    expect(chunks[1].startsWith("2. 기능 요구사항")).toBe(true);
  });
});

describe("extractWithLlm", () => {
  const doc: DocumentModel = { format: "docx", blocks: [{ type: "paragraph", text: "1. 서비스 요구사항\n내용" }] };
  const item = (o: Partial<LlmOutput["requirements"][number]>) => ({
    categoryName: "서비스 요구사항", reqId: null, title: "", definition: "", details: "", deliverables: "", related: "", ...o,
  });
  it("청크마다 호출해 합치고, ID 없는 항목은 구분 코드로 번호를 붙인다", async () => {
    const call = vi.fn<(chunk: string) => Promise<LlmOutput>>()
      .mockResolvedValueOnce({ requirements: [item({ reqId: "SER-001", title: "대화형" }), item({ title: "특화 화면" })] })
      .mockResolvedValueOnce({ requirements: [item({ reqId: "ser-001", title: "중복" }), item({ categoryName: "보안 요구사항", title: "암호화" })] });
    const doc2: DocumentModel = { format: "docx", blocks: [{ type: "paragraph", text: "A".repeat(50) }, { type: "paragraph", text: "B".repeat(50) }] };
    const r = await extractWithLlm(doc2, call, { maxChars: 60 });
    expect(call).toHaveBeenCalledTimes(2);
    expect(r.method).toBe("llm");
    expect(r.requirements.map((q) => q.reqId)).toEqual(["SER-001", "SER-002", "SEC-001"]);
    expect(r.requirements[1]).toMatchObject({ categoryCode: "SER", title: "특화 화면", sortOrder: 1, source: { llm: true } });
    expect(r.warnings.some((w) => w.includes("중복"))).toBe(true);
  });
  it("결과가 비면 경고", async () => {
    const r = await extractWithLlm(doc, async () => ({ requirements: [] }));
    expect(r.requirements).toEqual([]);
    expect(r.warnings).toEqual(["LLM이 요구사항을 하나도 찾지 못했습니다."]);
  });
  it("호출 실패는 청크 번호를 붙여 다시 던진다", async () => {
    await expect(extractWithLlm(doc, async () => { throw new Error("boom"); })).rejects.toThrow("LLM 추출 실패(청크 1/1): boom");
  });
});

describe("createAnthropicExtractCall", () => {
  it("API 키가 없으면 LlmUnavailableError", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => createAnthropicExtractCall()).toThrow(LlmUnavailableError);
  });
  it("키가 있으면 호출 함수를 만든다(네트워크는 쓰지 않음)", () => {
    expect(typeof createAnthropicExtractCall({ apiKey: "sk-test", model: "claude-opus-5" })).toBe("function");
  });
});

describe("LlmOutputSchema", () => {
  it("필드가 빠지면 거부", () => {
    expect(LlmOutputSchema.safeParse({ requirements: [{ title: "x" }] }).success).toBe(false);
    expect(LlmOutputSchema.safeParse({ requirements: [] }).success).toBe(true);
  });
});
