// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildUploadNotice, mapGraphUploadError, uploadProjectXlsx, SharepointFlowError, type UploadFlowDeps } from "@/lib/rfp/sharepoint";
import { GraphError } from "@/lib/ms/graph-drive";
import { NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import type { Notifier } from "@/lib/notify/types";
import type { ProjectDbRow } from "@/lib/rfp/mappers";

const folder = { url: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026", driveId: "b!drive", itemId: "01ITEM", name: "2026", webUrl: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026", setBy: "u-9", setAt: "2026-09-05T01:00:00.000Z" };
const project: ProjectDbRow = {
  id: "p-1", name: "생성형 AI 플랫폼 구축", agency: "한국석유공사", period: null, budget: null, bid_method: null, extra: {}, status: "ready", extraction_method: "standard", error: null, warnings: [],
  requirement_count: 3, created_by: "u-9", created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", mapping_status: "ready", mapping_error: null, mapping_warnings: [], mapping_at: null, sharepoint_folder: folder,
};
const FILE = "(한국석유공사) 생성형 AI 플랫폼 구축_요구사항 검토_20260905.xlsx";
const item = { id: "01FILE", name: FILE, webUrl: "https://innogrid.sharepoint.com/sites/RFP/Shared%20Documents/2026/x.xlsx", size: 4 };

function fakeAdmin(row: ProjectDbRow | null) {
  const inserted: Record<string, unknown>[] = [];
  const admin = {
    from(table: string) {
      if (table === "rfp_projects") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) };
      if (table === "rfp_sharepoint_uploads") {
        return {
          insert: (r: Record<string, unknown>) => {
            inserted.push(r);
            return { select: () => ({ single: async () => ({ data: { id: "up-1", ...r, created_at: "2026-09-05T03:00:00.000Z" }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
  return { admin, inserted };
}

function fakeNotifier(configured: boolean, result: { ok: boolean; error?: string } = { ok: true }) {
  const sendChannel = vi.fn(async () => result);
  const notifier = { provider: "teams", channelConfigured: configured, directConfigured: false, sendChannel, sendDirect: vi.fn() } as unknown as Notifier;
  return { notifier, sendChannel };
}

function deps(over: Partial<UploadFlowDeps> = {}): UploadFlowDeps {
  return {
    app: { tenantId: "t", clientId: "c", clientSecret: "s" },
    encKey: Buffer.alloc(32, 1),
    userName: "강승욱",
    notifier: fakeNotifier(true).notifier,
    getToken: vi.fn(async () => "AT"),
    build: vi.fn(async () => ({ buffer: Buffer.from("xlsx"), fileName: FILE })),
    upload: vi.fn(async () => item),
    ...over,
  };
}

describe("buildUploadNotice", () => {
  it("제목 'RFP 분석', 본문 [RFP] … — 사용자 · 폴더 / 파일명 / URL", () => {
    expect(buildUploadNotice({ projectName: "생성형 AI 플랫폼 구축", userName: "강승욱", folderName: "2026", fileName: FILE, webUrl: item.webUrl })).toEqual({
      title: "RFP 분석",
      text: `[RFP] 생성형 AI 플랫폼 구축 요구사항 검토 파일을 SharePoint에 올렸습니다 — 강승욱 · 2026\n${FILE}\n${item.webUrl}`,
    });
  });
});

describe("mapGraphUploadError", () => {
  const g = (status: number) => new GraphError(status, "code", "msg", "req");
  it("403·404·423·그 외 Graph·비Graph 오류를 스펙 §9 문구로", () => {
    expect(mapGraphUploadError(g(403))).toMatchObject({ status: 403, message: "이 폴더에 쓸 권한이 없습니다." });
    expect(mapGraphUploadError(g(404))).toMatchObject({ status: 404, message: "폴더가 없습니다(삭제·이동). 링크를 다시 지정하세요." });
    expect(mapGraphUploadError(g(423))).toMatchObject({ status: 409, message: "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요." });
    expect(mapGraphUploadError(g(500))).toMatchObject({ status: 502, message: "SharePoint 응답 오류(500)" });
    expect(mapGraphUploadError(g(429))).toMatchObject({ status: 502, message: "SharePoint 응답 오류(429)" });
    expect(mapGraphUploadError(new Error("socket hang up"))).toMatchObject({ status: 502, message: "socket hang up" });
    expect(mapGraphUploadError(g(403))).toBeInstanceOf(SharepointFlowError);
  });
});

describe("uploadProjectXlsx", () => {
  it("프로젝트 없음 404, 추출 미완 400, 폴더 없음 400 no_folder — 토큰·빌드는 부르지 않는다", async () => {
    const d = deps();
    await expect(uploadProjectXlsx(fakeAdmin(null).admin, "p-x", "u-1", d)).rejects.toMatchObject({ status: 404 });
    await expect(uploadProjectXlsx(fakeAdmin({ ...project, status: "extracting" }).admin, "p-1", "u-1", d)).rejects.toMatchObject({ status: 400, message: "요구사항 추출이 끝난 뒤 업로드할 수 있습니다." });
    await expect(uploadProjectXlsx(fakeAdmin({ ...project, sharepoint_folder: null }).admin, "p-1", "u-1", d)).rejects.toMatchObject({ status: 400, code: "no_folder" });
    expect(d.getToken).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
  });
  it("미연결 400 not_connected, 재연결 필요 409 reconnect", async () => {
    await expect(uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ getToken: vi.fn(async () => { throw new NotConnectedError(); }) }))).rejects.toMatchObject({ status: 400, code: "not_connected" });
    await expect(uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ getToken: vi.fn(async () => { throw new ReconnectRequiredError("invalid_grant"); }) }))).rejects.toMatchObject({ status: 409, code: "reconnect" });
  });
  it("성공: 토큰 → 빌드 → 폴더에 업로드 → 이력 insert → 알림, 응답 {upload, notified:true}", async () => {
    const { admin, inserted } = fakeAdmin(project);
    const { notifier, sendChannel } = fakeNotifier(true);
    const d = deps({ notifier, now: () => new Date("2026-09-05T03:00:00Z") });
    const res = await uploadProjectXlsx(admin, "p-1", "u-1", d);
    expect(d.getToken).toHaveBeenCalledWith(admin, "u-1", { app: d.app, encKey: d.encKey, fetchImpl: undefined });
    expect(d.build).toHaveBeenCalledWith(admin, project, new Date("2026-09-05T03:00:00Z"));
    expect(d.upload).toHaveBeenCalledTimes(1);
    const [token, target] = (d.upload as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, { driveId: string; itemId: string; fileName: string; buffer: Buffer }];
    expect(token).toBe("AT");
    expect(target).toMatchObject({ driveId: "b!drive", itemId: "01ITEM", fileName: FILE });
    expect(target.buffer.toString()).toBe("xlsx");
    expect(inserted).toEqual([{ project_id: "p-1", drive_id: "b!drive", item_id: "01FILE", file_name: FILE, web_url: item.webUrl, size_bytes: 4, uploaded_by: "u-1" }]);
    expect(res).toEqual({ upload: { id: "up-1", fileName: FILE, webUrl: item.webUrl, sizeBytes: 4, uploadedBy: { id: "u-1", name: "강승욱" }, createdAt: "2026-09-05T03:00:00.000Z" }, notified: true });
    expect(sendChannel).toHaveBeenCalledWith(buildUploadNotice({ projectName: project.name, userName: "강승욱", folderName: "2026", fileName: FILE, webUrl: item.webUrl }));
  });
  it("웹후크 미설정이면 알림을 부르지 않고 notified:false(notifyError 없음)", async () => {
    const { notifier, sendChannel } = fakeNotifier(false);
    const res = await uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ notifier }));
    expect(res.notified).toBe(false);
    expect("notifyError" in res).toBe(false);
    expect(sendChannel).not.toHaveBeenCalled();
  });
  it("알림 실패는 업로드 성공에 영향 없이 notified:false + notifyError", async () => {
    const { notifier } = fakeNotifier(true, { ok: false, error: "teams hook: 500 boom" });
    const res = await uploadProjectXlsx(fakeAdmin(project).admin, "p-1", "u-1", deps({ notifier }));
    expect(res).toMatchObject({ notified: false, notifyError: "teams hook: 500 boom" });
    expect(res.upload.fileName).toBe(FILE);
  });
  it("Graph 업로드 실패는 §9 문구로 바뀌고 이력은 남지 않는다", async () => {
    const { admin, inserted } = fakeAdmin(project);
    const upload = vi.fn(async () => { throw new GraphError(423, "resourceLocked", "locked", "r-1"); });
    await expect(uploadProjectXlsx(admin, "p-1", "u-1", deps({ upload }))).rejects.toMatchObject({ status: 409, message: "파일이 열려 있어 덮어쓸 수 없습니다. 잠시 뒤 다시 시도하세요." });
    expect(inserted).toEqual([]);
  });
  it("Graph가 이름·크기를 비워 보내면 파일명·버퍼 길이로 채운다", async () => {
    const a = fakeAdmin(project);
    await uploadProjectXlsx(a.admin, "p-1", "u-1", deps({ upload: vi.fn(async () => ({ ...item, name: "", size: 0 })) }));
    expect(a.inserted[0]).toMatchObject({ file_name: FILE, size_bytes: 4 });
  });
});
