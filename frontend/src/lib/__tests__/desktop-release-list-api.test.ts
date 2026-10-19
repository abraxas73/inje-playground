// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const m = vi.hoisted(() => ({ ok: true, value: "{}", signed: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok ? { ok: true, admin: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { value: m.value } }) }) }) }),
  storage: { from: () => ({ createSignedUrl: m.signed }) },
} } : { ok: false, response: NextResponse.json({}, { status: 403 }) } }));

import { GET } from "@/app/api/desktop/release/route";

const artifact = { version: "1.7.3", filename: "INNOGRID-Windows-1.7.3-Setup.exe", path: "windows/1.7.3/INNOGRID-Windows-1.7.3-Setup.exe", sha256: "a".repeat(64), bytes: 123, releasedAt: "2026-10-19T00:00:00Z" };
const request = (query = "") => (GET as (request: NextRequest) => Promise<Response>)(new NextRequest(`https://example.test/api/desktop/release${query}`));

beforeEach(() => {
  m.ok = true;
  m.value = JSON.stringify({ windows: artifact });
  m.signed.mockReset().mockResolvedValue({ data: { signedUrl: "https://storage.test/signed-installer" } });
});

it("플랫폼을 지정하면 그 최신 버전과 새 설치 링크만 내려준다", async () => {
  const response = await request("?platform=windows");
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({ version: "1.7.3", url: "https://storage.test/signed-installer" });
  expect(m.signed).toHaveBeenCalledWith(artifact.path, 300, { download: artifact.filename });
});

it("플랫폼이 없으면 /apps용 전체 릴리스 정보를 유지하고 링크를 발급하지 않는다", async () => {
  const response = await request();
  expect(await response.json()).toEqual({ windows: artifact });
  expect(m.signed).not.toHaveBeenCalled();
});

it("지원하지 않는 플랫폼과 아직 배포되지 않은 플랫폼은 설치 링크를 만들지 않는다", async () => {
  expect((await request("?platform=linux")).status).toBe(400);
  expect((await request("?platform=macos")).status).toBe(404);
  expect(m.signed).not.toHaveBeenCalled();
});
