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
  expect((await request("?platform=freebsd")).status).toBe(400);
  expect((await request("?platform=macos")).status).toBe(404);
  expect(m.signed).not.toHaveBeenCalled();
});

const deb = { version: "1.8.0", filename: "INNOGRID-Linux-1.8.0_amd64.deb", path: "linux/1.8.0/INNOGRID-Linux-1.8.0_amd64.deb", sha256: "b".repeat(64), bytes: 456, releasedAt: "2026-10-30T00:00:00Z",
  update: { build: 80, edSignature: Buffer.alloc(64, 2).toString("base64"), minimumOS: "22.04" } };

it("linux 자동 업데이트 요청은 같은 출처 artifact 주소·update·bytes를 준다", async () => {
  m.value = JSON.stringify({ linux: deb });
  const body = await (await request("?platform=linux&mode=automatic")).json();
  expect(body).toMatchObject({ url: "https://innocrew.innogrid.com/api/desktop/update/artifact/linux/1.8.0", bytes: 456, update: deb.update });
  expect(m.signed).not.toHaveBeenCalled();
});
