// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { verifyState } from "@/lib/ms/crypto";

const m = vi.hoisted(() => ({ status: 200 }));
const key = Buffer.alloc(32, 1);

vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.status === 200
  ? { ok: true, userId: "u1", email: "user@innogrid.com", admin: {} }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: m.status }) } }));
vi.mock("@/lib/ms/config", () => ({
  loadMsConfig: async () => ({ ok: true, config: { app: { tenantId: "tenant-1", clientId: "client-1", clientSecret: "secret" }, encKey: key } }),
  missingConfigMessage: () => "설정 누락",
}));

import { POST } from "@/app/api/mobile/ms-connect/route";

const request = (body: unknown) => new NextRequest("https://inje-playground.vercel.app/api/mobile/ms-connect", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeEach(() => { m.status = 200; });

it("앱 Bearer 사용자를 담은 일회성 Microsoft 승인 URL을 쿠키 세션 없이 발급한다", async () => {
  const res = await POST(request({ returnTo: "/sharepoint?tab=recent" }));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const url = new URL((await res.json()).url);
  expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize");
  expect(url.searchParams.get("login_hint")).toBe("user@innogrid.com");
  expect(url.searchParams.has("prompt")).toBe(false);
  expect(verifyState(url.searchParams.get("state")!, key)).toMatchObject({ u: "u1", r: "/sharepoint?tab=recent", a: true });
});

it("앱 인증이 없으면 승인 URL을 발급하지 않고 외부 returnTo는 기본 경로로 제한한다", async () => {
  const sanitized = await POST(request({ returnTo: "https://evil.test" }));
  const url = new URL((await sanitized.json()).url);
  expect(verifyState(url.searchParams.get("state")!, key)).toMatchObject({ r: "/settings", a: true });

  m.status = 401;
  const denied = await POST(request({ returnTo: "/sharepoint" }));
  expect(denied.status).toBe(401);
  expect(await denied.json()).toEqual({ error: "인증이 필요합니다." });
});
