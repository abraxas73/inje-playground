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

it("플랫폼별 버전과 링크 — APK는 600초 서명 URL(파일명 지정), iOS는 TestFlight 링크, no-store", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ notes: "n", ios: { version: "1.1.0", build: 3, releasedAt: null, url: "https://tf" }, android: { version: "1.1.0", build: 3, releasedAt: null, url: "https://signed/apk" } });
  expect(m.signed).toHaveBeenCalledWith("android/innogrid-1.1.0+3.apk", 600, { download: "innogrid-1.1.0+3.apk" });
});
it("설정이 없으면 빈 응답 200, 서명 호출 없음", async () => {
  m.value = null;
  const res = await GET();
  expect(await res.json()).toEqual({ notes: "", ios: null, android: null });
  expect(m.signed).not.toHaveBeenCalled();
});
it("서명 URL 실패는 android.url null로 200 유지", async () => {
  m.signed.mockResolvedValue({ data: null, error: { message: "boom" } });
  const j = await (await GET()).json();
  expect(j.android.url).toBeNull();
  expect(j.android.version).toBe("1.1.0");
});
it("guest·비로그인은 requireUser 응답 그대로", async () => { m.ok = false; expect((await GET()).status).toBe(403); });
