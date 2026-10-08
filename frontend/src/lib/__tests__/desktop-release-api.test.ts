// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true, value: "{}", signed: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok ? { ok: true, admin: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: m.value } }) }) }) }),
  storage: { from: () => ({ createSignedUrl: m.signed }) },
} } : { ok: false, response: NextResponse.json({}, { status: 403 }) } }));
import { GET } from "@/app/api/desktop/download/[platform]/route";
const request = (platform = "macos") => GET(new Request("https://example.test"), { params: Promise.resolve({ platform }) });
beforeEach(() => {
  m.ok = true;
  m.value = JSON.stringify({ macos: { version: "1.4.5", filename: "INNOGRID-macOS-1.4.5.dmg", path: "macos/1.4.5/INNOGRID-macOS-1.4.5.dmg", sha256: "a".repeat(64), bytes: 100, releasedAt: "2026-10-08" } });
  m.signed.mockReset().mockResolvedValue({ data: { signedUrl: "https://example.test/signed" } });
});
it("권한 없는 요청에 다운로드 URL을 발급하지 않는다", async () => { m.ok = false; expect((await request()).status).toBe(403); expect(m.signed).not.toHaveBeenCalled(); });
it("승인된 파일에만 짧은 만료 링크를 발급하고 캐시하지 않는다", async () => {
  const r = await request(); expect(r.status).toBe(307);
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(m.signed).toHaveBeenCalledWith("macos/1.4.5/INNOGRID-macOS-1.4.5.dmg", 300, { download: "INNOGRID-macOS-1.4.5.dmg" });
});
it("미배포 플랫폼과 임의 경로는 다운로드할 수 없다", async () => {
  expect((await request("windows")).status).toBe(404);
  expect((await request("../private")).status).toBe(404);
  m.value = m.value.replace('macos/1.4.5/', 'secrets/');
  expect((await request()).status).toBe(404); expect(m.signed).not.toHaveBeenCalled();
});
it("서명 오류는 실패 응답으로 표시한다", async () => { m.signed.mockResolvedValue({ error: {} }); expect((await request()).status).toBe(503); });
