import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { normalizeRoster, normalizeDepartments } from "@/lib/directory/parse";

export const runtime = "nodejs";

/** 명부가 이보다 적으면(그룹웨어 장애·부분 응답 의심) force 없이는 반영하지 않는다 — 전원 비활성 처리 사고 방지 */
const MIN_ROWS = 50;
const CHUNK = 200;
const MIN_DEPTS = 10;

/**
 * POST /api/admin/directory/sync
 * body: { source?: "amaranth", query?: string, people: AmaranthPerson[], departments?: AmaranthDept[], force?: boolean, note?: string }
 * departments(선택, GitHub Actions 동기화가 보냄): 부서 트리 upsert → 이번에 없던 부서 active=false. 사람과 같은 시작 시각을 쓴다.
 * 인증: 수집 토큰(Bearer CLAUDE_OTEL_INGEST_TOKEN — 로컬 동기화 스크립트) 또는 관리자 세션.
 * 동작: 이메일 기준 upsert(active=true, synced_at=지금) → 이번 명부에 없던 재직자 active=false → 동기화 로그 1행.
 */
export async function POST(request: NextRequest) {
  let syncedBy = "token";
  if (!verifyIngestToken(request.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN)) {
    const auth = await requireAdmin();
    if (!auth.ok) return auth.response;
    syncedBy = auth.userId;
  }
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const body = (await request.json().catch(() => null)) as
    | { source?: unknown; query?: unknown; people?: unknown; departments?: unknown; force?: unknown; note?: unknown }
    | null;
  if (!body || !Array.isArray(body.people)) {
    return NextResponse.json({ error: "people 배열이 필요합니다." }, { status: 400 });
  }
  const { rows, skipped } = normalizeRoster(body.people);
  if (rows.length === 0) return NextResponse.json({ error: "유효한 인원이 없습니다(이메일 필수)." }, { status: 400 });
  if (rows.length < MIN_ROWS && body.force !== true) {
    return NextResponse.json(
      { error: `명부가 ${rows.length}명으로 너무 적습니다(최소 ${MIN_ROWS}). 부분 응답이 의심되면 확인 후 force:true로 다시 보내세요.` },
      { status: 400 }
    );
  }

  const startedAt = new Date().toISOString();
  let upserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, active: true, synced_at: startedAt, updated_at: startedAt }));
    const { error } = await admin.from("company_directory").upsert(chunk, { onConflict: "email" });
    if (error) return NextResponse.json({ error: `company_directory upsert: ${error.message}` }, { status: 500 });
    upserted += chunk.length;
  }

  // 이번 명부에 없던 재직자 → 비활성(퇴사·이메일 변경). synced_at이 이번 시작 시각보다 이전이면 이번 명부에 없던 것.
  const deact = await admin
    .from("company_directory")
    .update({ active: false, updated_at: startedAt })
    .eq("active", true)
    .lt("synced_at", startedAt)
    .select("email");
  if (deact.error) return NextResponse.json({ error: `deactivate: ${deact.error.message}` }, { status: 500 });
  const deactivated = deact.data?.length ?? 0;

  // 부서 트리(있을 때만) — 사람과 같은 기준: 너무 적으면(부분 응답 의심) force 없이는 반영하지 않는다
  let departments = 0;
  if (Array.isArray(body.departments)) {
    const deps = normalizeDepartments(body.departments);
    if (deps.length < MIN_DEPTS && body.force !== true) {
      return NextResponse.json({ error: `부서가 ${deps.length}개로 너무 적습니다(최소 ${MIN_DEPTS}). 사람 명부는 반영됐습니다.` }, { status: 400 });
    }
    for (let i = 0; i < deps.length; i += CHUNK) {
      const chunk = deps.slice(i, i + CHUNK).map((d) => ({ ...d, active: true, synced_at: startedAt }));
      const { error } = await admin.from("company_departments").upsert(chunk, { onConflict: "id" });
      if (error) return NextResponse.json({ error: `company_departments upsert: ${error.message}` }, { status: 500 });
    }
    const gone = await admin.from("company_departments").update({ active: false }).eq("active", true).lt("synced_at", startedAt);
    if (gone.error) return NextResponse.json({ error: `departments deactivate: ${gone.error.message}` }, { status: 500 });
    departments = deps.length;
  }

  const source = typeof body.source === "string" && body.source.trim() ? body.source.trim().slice(0, 40) : "amaranth";
  const query = typeof body.query === "string" ? body.query.slice(0, 80) : null;
  const note = [typeof body.note === "string" ? body.note.slice(0, 200) : null, skipped ? `skipped=${skipped}` : null].filter(Boolean).join(" ") || null;
  const log = await admin
    .from("company_directory_sync")
    .insert({ synced_at: startedAt, source, query, total: rows.length, upserted, deactivated, synced_by: syncedBy, note })
    .select("*")
    .single();
  if (log.error) return NextResponse.json({ error: `sync log: ${log.error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true, synced_at: startedAt, total: rows.length, upserted, deactivated, skipped, departments, sync: log.data });
}
