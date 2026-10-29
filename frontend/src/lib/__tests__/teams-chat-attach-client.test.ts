// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { splitAttachments, UPLOAD_CHUNK, uploadToSession } from "@/lib/teams/chat-attach-client";

const MB = 1024 * 1024;
describe("Teams 채팅 첨부(화면)", () => {
  it("splitAttachments — 형식 맞는 그림은 합계 3MB·4장까지 본문, 나머지(큰 그림·SVG·문서)는 파일", () => {
    const f = (name: string, type: string, size: number) => ({ name, type, size });
    const { images, files } = splitAttachments([f("a.png", "image/png", 1 * MB), f("b.jpg", "image/jpeg", 2.5 * MB), f("c.svg", "image/svg+xml", 10), f("d.pdf", "application/pdf", 10), f("e.gif", "image/gif", 1 * MB), f("g.png", "image/png", 10), f("h.png", "image/png", 10), f("i.png", "image/png", 10)]);
    expect(images.map((x) => x.name)).toEqual(["a.png", "e.gif", "g.png", "h.png"]);
    expect(files.map((x) => x.name)).toEqual(["b.jpg", "c.svg", "d.pdf", "i.png"]);
  });
  it("uploadToSession — 320KiB 배수 조각으로 Content-Range PUT, 마지막 응답의 id", async () => {
    const size = UPLOAD_CHUNK * 2 + 5;
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      const range = (init.headers as Record<string, string>)["Content-Range"];
      return range.endsWith(`-${size - 1}/${size}`) ? new Response(JSON.stringify({ id: "ITEM9" }), { status: 201 }) : new Response("{}", { status: 202 });
    });
    expect(await uploadToSession(new Blob([new Uint8Array(size)]), "https://up/x", fetchImpl as never)).toBe("ITEM9");
    expect(fetchImpl.mock.calls.map(([, i]) => (i.headers as Record<string, string>)["Content-Range"])).toEqual([`bytes 0-${UPLOAD_CHUNK - 1}/${size}`, `bytes ${UPLOAD_CHUNK}-${UPLOAD_CHUNK * 2 - 1}/${size}`, `bytes ${UPLOAD_CHUNK * 2}-${size - 1}/${size}`]);
    expect(UPLOAD_CHUNK % (320 * 1024)).toBe(0);
    await expect(uploadToSession(new Blob(["x"]), "https://up/x", (async () => new Response("", { status: 500 })) as never)).rejects.toThrow("파일을 올리지 못했습니다 (500)");
  });
});
