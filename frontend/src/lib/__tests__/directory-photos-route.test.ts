// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const upload = vi.fn();
const download = vi.fn();
const storage = { from: () => ({ upload, download, list: async () => ({ data: [{ name: "a_jpg" }], error: null }) }) };
vi.mock("@/lib/claude-usage/ingest-auth", () => ({ verifyIngestToken: (h: string | null) => h === "Bearer ok" }));
vi.mock("@/lib/claude-usage/require-admin", () => ({
  requireAdmin: async () => ({ ok: false, response: new Response(null, { status: 403 }) }),
  adminClientOr500: () => ({ ok: true, admin: { storage } }),
}));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin: { storage } }) }));

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]).toString("base64");
const post = async (photos: unknown, token = "Bearer ok") => {
  const { POST } = await import("@/app/api/admin/directory/photos/route");
  return POST(new Request("http://x/api/admin/directory/photos", { method: "POST", headers: { authorization: token }, body: JSON.stringify({ photos }) }) as never);
};

describe("조직도 사진 수집·조회 API", () => {
  beforeEach(() => { upload.mockReset(); upload.mockResolvedValue({ error: null }); download.mockReset(); });

  it("수집 토큰 없으면 거부, 그림만·안전한 id만 thumb/·large/에 저장", async () => {
    expect((await post([], "Bearer no")).status).toBe(403);
    const r = await post([
      { id: "a_jpg", thumb: jpeg, large: jpeg },
      { id: "../x", thumb: jpeg, large: jpeg },
      { id: "b_jpg", thumb: Buffer.from("<svg/>").toString("base64"), large: jpeg },
    ]);
    expect(await r.json()).toEqual({ stored: 1, rejected: 2 });
    expect(upload.mock.calls.map((c) => [c[0], c[2].contentType, c[2].upsert])).toEqual([["thumb/a_jpg", "image/jpeg", false], ["large/a_jpg", "image/jpeg", false]]);
    // 이미 있는 사진은 덮어쓰지 않고 넘어간다
    upload.mockResolvedValue({ error: { message: "The resource already exists" } });
    expect((await post([{ id: "a_jpg", thumb: jpeg, large: jpeg }])).status).toBe(200);
  });

  it("한 번에 25장 넘게는 받지 않는다", async () => {
    expect((await post(Array.from({ length: 26 }, () => ({})))).status).toBe(400);
  });

  it("GET /api/directory/photo/{id} — 이상한 id는 400, 없으면 404, 있으면 그림·개인 캐시", async () => {
    const { GET } = await import("@/app/api/directory/photo/[id]/route");
    const get = (id: string, q = "") => GET(new NextRequest(`http://x/api/directory/photo/${id}${q}`), { params: Promise.resolve({ id }) });
    expect((await get("..")).status).toBe(400);
    download.mockResolvedValue({ data: null, error: { message: "not found" } });
    expect((await get("a_jpg")).status).toBe(404);
    download.mockResolvedValue({ data: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }), error: null });
    const ok = await get("a_jpg", "?size=large");
    expect([ok.status, ok.headers.get("content-type"), ok.headers.get("cache-control")]).toEqual([200, "image/jpeg", "private, max-age=604800, immutable"]);
    expect(download).toHaveBeenLastCalledWith("large/a_jpg");
  });
});
