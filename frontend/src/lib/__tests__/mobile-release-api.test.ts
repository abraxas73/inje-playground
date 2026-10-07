// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, value: null as string | null, signed: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.value === null ? null : { value: m.value }, error: null }) }) }) }),
      storage: { from: () => ({ createSignedUrl: m.signed }) },
    } }
  : { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) } }));
import { GET } from "@/app/api/mobile/release/route";
const rel = JSON.stringify({ notes: "n", testflightUrl: "https://tf", android: { version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk" }, ios: { version: "1.1.0", build: 3 } });
beforeEach(() => { m.ok = true; m.value = rel; m.signed.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed/apk" }, error: null }); });

it("플랫폼별 버전과 링크 — Android는 Google Play 내부 테스트, iOS는 TestFlight 링크, no-store", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ notes: "n", ios: { version: "1.1.0", build: 3, releasedAt: null, url: "https://tf" }, android: { version: "1.1.0", build: 3, releasedAt: null, url: "https://play.google.com/apps/internaltest/4701070333674267983" } });
  expect(m.signed).not.toHaveBeenCalled();
});
it("설정이 없으면 빈 응답 200, 서명 호출 없음", async () => {
  m.value = null;
  const res = await GET();
  expect(await res.json()).toEqual({ notes: "", ios: null, android: null });
  expect(m.signed).not.toHaveBeenCalled();
});
it("APK 스토리지 오류와 무관하게 Google Play 링크 제공", async () => {
  m.signed.mockResolvedValue({ data: null, error: { message: "boom" } });
  const j = await (await GET()).json();
  expect(j.android.url).toBe("https://play.google.com/apps/internaltest/4701070333674267983");
  expect(m.signed).not.toHaveBeenCalled();
  expect(j.android.version).toBe("1.1.0");
});
it("guest·비로그인은 requireUser 응답 그대로", async () => { m.ok = false; expect((await GET()).status).toBe(403); });
