// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GraphError } from "@/lib/ms/graph-drive";

const m = vi.hoisted(() => ({
  session: false as boolean, settings: {} as Record<string, string>, profile: { user_id: "u-admin", role: "admin" } as unknown,
  token: { ok: true, token: "AT" } as unknown, resolve: vi.fn(), upload: vi.fn(), upsert: vi.fn(), download: vi.fn(), audit: vi.fn(),
}));
const admin = {
  from: (table: string) => ({
    select: () => ({
      in: async () => ({ data: Object.entries(m.settings).map(([key, value]) => ({ key, value })), error: null }),
      eq: () => ({ maybeSingle: async () => ({ data: table === "user_profiles" ? m.profile : null, error: null }) }),
    }),
    upsert: m.upsert,
  }),
  storage: { from: () => ({ download: m.download }) },
};
vi.mock("@/lib/claude-usage/require-admin", () => ({
  adminClientOr500: () => ({ ok: true, admin }),
  requireAdmin: async () => m.session ? { ok: true, userId: "u-session", email: "me@innogrid.com" } : { ok: false, response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 401 }) },
}));
vi.mock("@/lib/ms/route-token", () => ({ graphTokenForUser: async () => m.token }));
vi.mock("@/lib/ms/graph-drive", async (orig) => ({ ...(await orig<typeof import("@/lib/ms/graph-drive")>()), resolveFolder: m.resolve, uploadFile: m.upload }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/mobile/release/sharepoint/route";

const rel = { notes: "n", testflightUrl: null, android: { version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk", releasedAt: "2026-10-04T06:00:00Z" } };
const req = (init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest("https://app.test/api/mobile/release/sharepoint", { method: "POST", ...init });
const asScript = (operator = "me@innogrid.com") => req({ headers: { authorization: "Bearer s3cret", "content-type": "application/json" }, body: JSON.stringify({ operator }) });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret");
  m.session = false; m.profile = { user_id: "u-admin", role: "admin" }; m.token = { ok: true, token: "AT" };
  m.settings = { mobile_release: JSON.stringify(rel), mobile_sharepoint_folder: "https://innogrid.sharepoint.com/sites/x/Shared%20Documents/apps" };
  m.resolve.mockReset().mockResolvedValue({ driveId: "d1", itemId: "f1", name: "apps", webUrl: "https://sp/apps" });
  m.upload.mockReset().mockResolvedValue({ id: "i1", name: "innogrid-app-1.1.0.apk", webUrl: "https://sp/apps/innogrid-app-1.1.0.apk", size: 5 });
  m.upsert.mockReset().mockResolvedValue({ error: null });
  m.download.mockReset().mockResolvedValue({ data: new Blob([new Uint8Array([1, 2, 3, 4, 5])]), error: null });
  m.audit.mockReset();
});

it("스크립트(CRON_SECRET + operator 관리자): 스토리지 APK를 읽어 폴더 링크를 풀고 innogrid-app-<major.minor.patch>.apk로 올린 뒤 링크를 설정에 남긴다", async () => {
  const res = await POST(asScript());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ webUrl: "https://sp/apps/innogrid-app-1.1.0.apk", name: "innogrid-app-1.1.0.apk", folderName: "apps" });
  expect(m.download).toHaveBeenCalledWith("android/innogrid-1.1.0+3.apk");
  expect(m.resolve).toHaveBeenCalledWith("AT", "https://innogrid.sharepoint.com/sites/x/Shared%20Documents/apps");
  const t = m.upload.mock.calls[0][1];
  expect([t.driveId, t.itemId, t.fileName, t.contentType, t.buffer.length]).toEqual(["d1", "f1", "innogrid-app-1.1.0.apk", "application/vnd.android.package-archive", 5]);
  const saved = JSON.parse(m.upsert.mock.calls[0][0].value);
  expect(saved.android.sharepointUrl).toBe("https://sp/apps/innogrid-app-1.1.0.apk");
  expect(saved.android.apkPath).toBe("android/innogrid-1.1.0+3.apk");
  expect(m.upsert.mock.calls[0][1]).toEqual({ onConflict: "key" });
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(m.audit.mock.calls[0][2])).not.toContain("AT");
});
it("관리자 세션으로도 된다(본인 Microsoft 연결)", async () => {
  m.session = true;
  expect((await POST(req())).status).toBe(200);
});
it("비밀이 틀리고 세션도 없으면 401, operator가 관리자가 아니면 403", async () => {
  expect((await POST(req({ headers: { authorization: "Bearer nope" } }))).status).toBe(401);
  m.profile = { user_id: "u2", role: "user" };
  expect((await POST(asScript("someone@innogrid.com"))).status).toBe(403);
  expect(m.upload).not.toHaveBeenCalled();
});
it("폴더 링크가 없으면 400 no_folder, Android 릴리스가 없으면 409", async () => {
  m.settings = { mobile_release: JSON.stringify(rel) };
  const r1 = await POST(asScript());
  expect(r1.status).toBe(400);
  expect((await r1.json()).code).toBe("no_folder");
  m.settings = { mobile_release: JSON.stringify({ notes: "", ios: { version: "1.0.0", build: 1 } }), mobile_sharepoint_folder: "https://sp/x" };
  expect((await POST(asScript())).status).toBe(409);
  expect(m.upload).not.toHaveBeenCalled();
});
it("Graph 권한 오류는 매핑된 상태로(403), 토큰 실패는 그 응답 그대로", async () => {
  m.upload.mockRejectedValue(new GraphError(403, "accessDenied", "denied", null));
  const r = await POST(asScript());
  expect(r.status).toBe(403);
  expect(m.upsert).not.toHaveBeenCalled();
  m.token = { ok: false, response: NextResponse.json({ error: "Microsoft 계정을 먼저 연결하세요.", code: "not_connected" }, { status: 400 }) };
  expect((await POST(asScript())).status).toBe(400);
});
