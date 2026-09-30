import { describe, expect, it } from "vitest";
import { parseCreateRequest, parseRegenerateRequest } from "@/lib/ppt/request";

describe("parseCreateRequest", () => {
  it("accepts text", () => {
    const r = parseCreateRequest({ text: "원고", prompt: " 12장 ", title: "제안", dept: "R&D" });
    expect(r).toEqual({ ok: true, kind: "text", text: "원고", storagePath: null, fileName: null, prompt: "12장", title: "제안", dept: "R&D" });
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
