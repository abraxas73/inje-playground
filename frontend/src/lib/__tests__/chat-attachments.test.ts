// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/ppt/source", () => ({ textFromDocument: vi.fn(async (buf: Buffer, name: string) => (name.endsWith(".pdf") && buf.toString() === "scan" ? "" : `본문:${name}`)) }));
vi.mock("@/lib/rfp/parse", () => ({ parseDocumentAsync: vi.fn(async () => ({ kind: "xlsx" })) }));
vi.mock("@/lib/rfp/document-model", () => ({ documentText: () => "시트 내용" }));
import { attachmentBlocks, extOf, extractAttachment } from "@/lib/chat/attachments";

describe("첨부 추출", () => {
  it("문서는 텍스트, xlsx는 시트 텍스트, 이미지는 원본", async () => {
    expect(await extractAttachment(Buffer.from("x"), "보고.docx", {})).toEqual({ kind: "text", text: "본문:보고.docx" });
    expect(await extractAttachment(Buffer.from("x"), "표.xlsx", {})).toEqual({ kind: "text", text: "시트 내용" });
    expect(await extractAttachment(Buffer.from("x"), "사진.PNG", {})).toEqual({ kind: "image" });
  });
  it("텍스트가 빈 PDF는 원본(스캔), pptx는 추출기가 없으면 오류", async () => {
    expect(await extractAttachment(Buffer.from("scan"), "스캔.pdf", {})).toEqual({ kind: "pdf" });
    await expect(extractAttachment(Buffer.from("x"), "발표.pptx", {})).rejects.toThrow("PPT");
    expect(await extractAttachment(Buffer.from("x"), "발표.pptx", { pptx: async () => "장표" })).toEqual({ kind: "text", text: "장표" });
  });
  it("허용 밖 확장자는 오류", async () => {
    await expect(extractAttachment(Buffer.from("x"), "a.exe", {})).rejects.toThrow("첨부할 수 없는");
    expect(extOf("A.Tar.GZ")).toBe("gz");
  });
  it("모델 블록 — 텍스트는 이름 머리말, 이미지·PDF는 base64", () => {
    const row = { id: "a", name: "보고.docx", mime: "application/x", kind: "text" as const, storage_path: "u/a/original.docx", masked_count: 0 };
    expect(attachmentBlocks(row, { text: "내용" })).toEqual([{ type: "text", text: "[첨부: 보고.docx]\n내용" }]);
    const img = attachmentBlocks({ ...row, name: "p.png", mime: "image/png", kind: "image" }, { original: Buffer.from("png") });
    expect(img[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("png").toString("base64") } });
    const pdf = attachmentBlocks({ ...row, name: "s.pdf", mime: "application/pdf", kind: "pdf" }, { original: Buffer.from("%PDF") });
    expect(pdf[1]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf" } });
    expect(attachmentBlocks({ ...row, kind: "image" }, {})).toEqual([{ type: "text", text: "[첨부: 보고.docx — 파일을 읽지 못함]" }]);
  });
});
