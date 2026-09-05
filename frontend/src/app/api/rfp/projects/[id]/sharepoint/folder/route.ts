import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadMsConfig, missingConfigMessage } from "@/lib/ms/config";
import { getAccessTokenForUser, NotConnectedError, ReconnectRequiredError } from "@/lib/ms/connections";
import { FolderResolveError, GraphError, resolveFolder, type ResolvedFolder } from "@/lib/ms/graph-drive";
import { OAuthError, oauthErrorMessage } from "@/lib/ms/oauth";
import type { SharepointFolder } from "@/types/rfp";

export const runtime = "nodejs";
export const maxDuration = 30;
type Params = { params: Promise<{ id: string }> };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PUT /api/rfp/projects/[id]/sharepoint/folder {url} — 폴더 링크를 Graph shares로 해석해 프로젝트에 저장(스펙 §4).
 * 400 형식·파일 링크·해석 실패·{code:not_connected} / 403 볼 권한 없음 / 409 {code:reconnect} / 502 Graph 오류
 */
export async function PUT(request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!url || url.length > 2000 || !/^https:\/\//i.test(url)) {
    return NextResponse.json({ error: "https로 시작하는 폴더 링크를 붙여 주세요(2000자 이하)." }, { status: 400 });
  }

  const { data: project, error } = await auth.admin.from("rfp_projects").select("id").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!project) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });

  const cfg = await loadMsConfig(await createServerSupabase());
  if (!cfg.ok) {
    console.error("[ms] 연결 설정 누락:", cfg.missing.join(", "));
    return NextResponse.json({ error: missingConfigMessage(cfg.missing) }, { status: 500 });
  }

  let token: string;
  try {
    token = await getAccessTokenForUser(auth.admin, auth.userId, { app: cfg.config.app, encKey: cfg.config.encKey });
  } catch (e) {
    if (e instanceof NotConnectedError) return NextResponse.json({ error: e.message, code: "not_connected" }, { status: 400 });
    if (e instanceof ReconnectRequiredError) return NextResponse.json({ error: e.message, code: "reconnect" }, { status: 409 });
    if (e instanceof OAuthError) {
      console.error(`[ms] 토큰 갱신 실패 ${e.code} (${e.status}): ${e.description}`);
      return NextResponse.json({ error: oauthErrorMessage(e.code) }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "토큰을 발급하지 못했습니다." }, { status: 500 });
  }

  let resolved: ResolvedFolder;
  try {
    resolved = await resolveFolder(token, url);
  } catch (e) {
    if (e instanceof FolderResolveError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof GraphError) {
      console.error(`[ms] 폴더 해석 실패 status=${e.status} code=${e.code} request-id=${e.requestId ?? "-"}`);
      return NextResponse.json({ error: `SharePoint 응답 오류(${e.status})` }, { status: 502 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : "폴더를 해석하지 못했습니다." }, { status: 500 });
  }

  const folder: SharepointFolder = { url, driveId: resolved.driveId, itemId: resolved.itemId, name: resolved.name, webUrl: resolved.webUrl, setBy: auth.userId, setAt: new Date().toISOString() };
  const { error: upErr } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: folder, updated_by: auth.userId }).eq("id", id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
  return NextResponse.json({ folder });
}

/** DELETE /api/rfp/projects/[id]/sharepoint/folder — 폴더 지정 해제(이력은 남는다) */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: "잘못된 프로젝트 ID입니다." }, { status: 400 });
  const { data, error } = await auth.admin.from("rfp_projects").update({ sharepoint_folder: null, updated_by: auth.userId }).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "프로젝트가 없습니다." }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
