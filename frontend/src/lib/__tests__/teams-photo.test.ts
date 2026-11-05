// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { TEAMS_PHOTO_FRESH_MS, teamsPhoto } from "@/lib/teams/photo";

const ID = "0f3c2a1b-1111-2222-3333-444455556666";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const NOW = Date.parse("2026-11-05T03:00:00Z");

function fakeAdmin(saved?: { at: number; bytes: Uint8Array }) {
  const store = new Map<string, { at: number; bytes: Uint8Array }>(saved ? [[`teams/${ID}`, saved]] : []);
  const bucket = {
    list: vi.fn(async () => ({ data: [...store].map(([p, v]) => ({ name: p.slice(6), updated_at: new Date(v.at).toISOString() })), error: null })),
    download: vi.fn(async (p: string) => (store.has(p) ? { data: new Blob([store.get(p)!.bytes as BlobPart]), error: null } : { data: null, error: new Error("x") })),
    upload: vi.fn(async (p: string, b: ArrayBuffer) => { store.set(p, { at: NOW, bytes: new Uint8Array(b) }); return { error: null }; }),
    remove: vi.fn(async (ps: string[]) => { ps.forEach((p) => store.delete(p)); return { error: null }; }),
  };
  return { admin: { storage: { from: () => bucket } } as never, bucket, store };
}
const img = (p: unknown) => p as { body: ArrayBuffer; type: string } | null;
const res = (status: number, body?: Uint8Array) => new Response(body ? (body as BlobPart) : null, { status });

describe("teamsPhoto", () => {
  it("하루 안 사본은 Graph 없이 그대로", async () => {
    const { admin } = fakeAdmin({ at: NOW - 1000, bytes: JPEG });
    const fetchImpl = vi.fn();
    const p = await teamsPhoto(admin, ID.toUpperCase(), async () => "AT", fetchImpl as never, NOW);
    expect(img(p)?.type).toBe("image/jpeg");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("없거나 하루 지났으면 96px을 받아 저장(정해진 크기가 없으면 원본 크기)", async () => {
    const { admin, bucket, store } = fakeAdmin({ at: NOW - TEAMS_PHOTO_FRESH_MS - 1, bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) });
    const fetchImpl = vi.fn().mockResolvedValueOnce(res(404)).mockResolvedValueOnce(res(200, JPEG));
    const p = await teamsPhoto(admin, ID, async () => "AT", fetchImpl as never, NOW);
    expect(new Uint8Array(img(p)!.body)).toEqual(JPEG);
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([`https://graph.microsoft.com/v1.0/users/${ID}/photos/96x96/$value`, `https://graph.microsoft.com/v1.0/users/${ID}/photo/$value`]);
    expect(bucket.upload).toHaveBeenCalledWith(`teams/${ID}`, expect.anything(), { contentType: "image/jpeg", upsert: true });
    expect(store.get(`teams/${ID}`)?.bytes).toEqual(JPEG);
  });

  it("사진을 지웠으면(404) 사본도 지우고 none", async () => {
    const { admin, store } = fakeAdmin({ at: 0, bytes: JPEG });
    const p = await teamsPhoto(admin, ID, async () => "AT", vi.fn().mockResolvedValue(res(404)) as never, NOW);
    expect(p).toBe("none");
    expect(store.size).toBe(0);
  });

  it("토큰이 없거나 Graph 장애·그림이 아니면 오래된 사본이라도, 없으면 null(저장 안 함)", async () => {
    const old = fakeAdmin({ at: 0, bytes: JPEG });
    expect(img(await teamsPhoto(old.admin, ID, async () => null, vi.fn() as never, NOW))?.type).toBe("image/jpeg");
    expect(img(await teamsPhoto(old.admin, ID, async () => "AT", vi.fn().mockResolvedValue(res(503)) as never, NOW))?.type).toBe("image/jpeg");
    const none = fakeAdmin();
    expect(await teamsPhoto(none.admin, ID, async () => "AT", vi.fn().mockResolvedValue(res(200, new Uint8Array([60, 104, 116]))) as never, NOW)).toBeNull();
    expect(none.bucket.upload).not.toHaveBeenCalled();
  });
});
