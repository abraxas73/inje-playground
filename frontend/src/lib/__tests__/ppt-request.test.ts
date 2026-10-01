import { describe, expect, it } from "vitest";
import { parseCreateRequest, parseRegenerateRequest, provisionalTitle } from "@/lib/ppt/request";

describe("parseCreateRequest", () => {
  it("accepts text", () => {
    const r = parseCreateRequest({ text: "원고", prompt: " 12장 ", title: "제안", dept: "R&D" });
    expect(r).toEqual({ ok: true, kind: "text", text: "원고", storagePath: null, fileName: null, prompt: "12장", title: "제안", dept: "R&D", model: null, templateId: null });
  });
  it("accepts a file ticket and classifies pptx", () => {
    const path = "source/0d1f0f7e-1111-4222-8333-444455556666.pptx";
    const r = parseCreateRequest({ storagePath: path, fileName: "원고.PPTX", prompt: "" });
    expect(r).toMatchObject({ ok: true, kind: "pptx", storagePath: path, fileName: "원고.PPTX", title: null, dept: null });
  });
  it("rejects neither/both, long text, bad paths and extension mismatch", () => {
    expect(parseCreateRequest({ prompt: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateRequest({ text: "a", storagePath: "source/0d1f0f7e-1111-4222-8333-444455556666.docx", fileName: "a.docx", prompt: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateRequest({ text: "x".repeat(60001), prompt: "" })).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("60,001자") });
    expect(parseCreateRequest({ storagePath: "uploads/x.docx", fileName: "a.docx", prompt: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateRequest({ storagePath: "source/0d1f0f7e-1111-4222-8333-444455556666.docx", fileName: "a.pdf", prompt: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateRequest({ text: "a", prompt: "p".repeat(2001) })).toMatchObject({ ok: false, status: 400 });
    expect(parseCreateRequest(null)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("parseCreateRequest model", () => {
  it("accepts a listed model, defaults to null, rejects others", () => {
    expect(parseCreateRequest({ text: "x", prompt: "", model: "claude-opus-5-5" })).toMatchObject({ ok: true, model: "claude-opus-5-5" });
    expect(parseCreateRequest({ text: "x", prompt: "" })).toMatchObject({ ok: true, model: null });
    expect(parseCreateRequest({ text: "x", prompt: "", model: "claude-haiku-4-5" })).toMatchObject({ ok: false, status: 400, error: "선택할 수 없는 모델입니다." });
  });
  it("templateId must be a uuid when given; null means the built-in template", () => {
    expect(parseCreateRequest({ text: "x", prompt: "", templateId: "0d1f0f7e-1111-4222-8333-444455556666" })).toMatchObject({ ok: true, templateId: "0d1f0f7e-1111-4222-8333-444455556666" });
    expect(parseCreateRequest({ text: "x", prompt: "", templateId: null })).toMatchObject({ ok: true, templateId: null });
    expect(parseCreateRequest({ text: "x", prompt: "", templateId: "builtin" })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("provisionalTitle", () => {
  it("prefers the typed title, then the file name without extension, then the first meaningful text line", () => {
    expect(provisionalTitle({ title: "제안", fileName: "a.pptx", text: null })).toBe("제안");
    expect(provisionalTitle({ title: null, fileName: "(기술운영부분) 신규입사자 소개 자료v2.0.pptx", text: null })).toBe("(기술운영부분) 신규입사자 소개 자료v2.0");
    expect(provisionalTitle({ title: null, fileName: null, text: "\n\n## 2026년   사업 계획\n본문" })).toBe("2026년 사업 계획");
    expect(provisionalTitle({ title: null, fileName: null, text: "- 첫 불릿\n" })).toBe("첫 불릿");
    expect(provisionalTitle({ title: null, fileName: null, text: "가".repeat(100) })).toHaveLength(80);
    expect(provisionalTitle({ title: null, fileName: null, text: "   " })).toBe("");
  });
});

describe("parseRegenerateRequest", () => {
  it("requires feedback and accepts an optional base version", () => {
    expect(parseRegenerateRequest({ feedback: "  3장을 표로 " })).toEqual({ ok: true, retry: false, feedback: "3장을 표로", baseVersion: null });
    expect(parseRegenerateRequest({ feedback: "x", baseVersion: 2 })).toEqual({ ok: true, retry: false, feedback: "x", baseVersion: 2 });
    expect(parseRegenerateRequest({ retry: true })).toEqual({ ok: true, retry: true, feedback: null, baseVersion: null });
    expect(parseRegenerateRequest({})).toEqual({ ok: false, status: 400, error: "피드백을 입력하세요." });
    expect(parseRegenerateRequest({ feedback: "" })).toMatchObject({ ok: false, status: 400 });
    expect(parseRegenerateRequest({ feedback: "x", baseVersion: 0 })).toMatchObject({ ok: false, status: 400 });
  });
});
