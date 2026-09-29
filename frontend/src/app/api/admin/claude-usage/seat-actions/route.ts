import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500 } from "@/lib/claude-usage/require-admin";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";
import { logAudit } from "@/lib/audit";
import { normalizeTier } from "@/lib/claude-usage/seat-tier";
import { canTransition, checkRequest, parseRequest } from "@/lib/claude-usage/seat-actions";
import type { SeatAction, SeatActionStatus } from "@/types/claude-seat";

export const runtime = "nodejs";

/**
 * Claude 시트 할당·해제 요청(claude_seat_actions). 스펙 docs/superpowers/specs/2026-09-29-claude-seat-actions-design.md §5
 * 관리자 세션:
 *   GET  ?email=&org=&status=&limit=   이력(requested_at 내림차순) + 실행기 하트비트
 *   POST { org_id, email, action, target_tier? }   요청 생성(활성 멤버·중복·티어 검증) → 201
 *   DELETE ?id=                        requested만 취소
 * 실행기(Bearer CLAUDE_OTEL_INGEST_TOKEN):
 *   GET  ?claim=1&executor=            가장 오래된 requested 1건을 running으로(RPC claude_seat_action_claim). 10분 넘은 running은 먼저 failed 처리
 *   PATCH { id, status: done|failed, before_tier?, after_tier?, error?, executor }   결과 반영. done이면 claude_org_members.seat_tier 갱신
 */

const NO_STORE = { "Cache-Control": "no-store" };
const isExecutor = (req: NextRequest) => verifyIngestToken(req.headers.get("authorization"), process.env.CLAUDE_OTEL_INGEST_TOKEN);
const STATUSES = new Set<string>(["requested", "running", "done", "failed", "cancelled"]);

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  if (sp.get("claim") === "1") {
    if (!isExecutor(request)) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
    // 실행기가 죽어 running으로 남은 행은 10분 뒤 실패 처리해 다음 요청을 막지 않는다
    await admin.from("claude_seat_actions").update({ status: "failed", finished_at: new Date().toISOString(), error: "실행기 재시작(10분 초과)" })
      .eq("status", "running").lt("started_at", new Date(Date.now() - 600_000).toISOString());
    const r = await admin.rpc("claude_seat_action_claim", { p_executor: (sp.get("executor") ?? "unknown").slice(0, 80) });
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500, headers: NO_STORE });
    const row = (Array.isArray(r.data) ? r.data[0] : null) ?? null;
    return NextResponse.json({ row }, { headers: NO_STORE });
  }

  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const email = (sp.get("email") ?? "").trim().toLowerCase();
  const org = (sp.get("org") ?? "").trim();
  const status = sp.get("status") ?? "";
  const limit = Math.min(1000, Math.max(1, Number(sp.get("limit") ?? 200) || 200));
  let q = admin.from("claude_seat_actions").select("*").order("requested_at", { ascending: false }).limit(limit);
  if (email) q = q.eq("email", email);
  if (org && org !== "all") q = q.eq("org_id", org);
  if (STATUSES.has(status)) q = q.eq("status", status);
  const [rows, ex] = await Promise.all([q, admin.from("claude_seat_executor").select("*").eq("id", "default").maybeSingle()]);
  if (rows.error) return NextResponse.json({ error: rows.error.message }, { status: 500 });
  return NextResponse.json({ rows: rows.data ?? [], executor: ex.error ? null : ex.data ?? null }, { headers: NO_STORE });
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;

  const parsed = parseRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  const [org, member, open] = await Promise.all([
    admin.from("claude_orgs").select("id").eq("id", input.org_id).maybeSingle(),
    admin.from("claude_org_members").select("status, seat_tier").eq("org_id", input.org_id).eq("email", input.email).maybeSingle(),
    admin.from("claude_seat_actions").select("id").eq("org_id", input.org_id).eq("email", input.email).in("status", ["requested", "running"]).limit(1),
  ]);
  if (org.error) return NextResponse.json({ error: org.error.message }, { status: 500 });
  if (member.error) return NextResponse.json({ error: member.error.message }, { status: 500 });
  if (open.error) return NextResponse.json({ error: open.error.message }, { status: 500 });
  if (!org.data) return NextResponse.json({ error: "모르는 Claude 조직입니다." }, { status: 404 });
  const problem = checkRequest(input, member.data ?? null, (open.data?.length ?? 0) > 0);
  if (problem) return NextResponse.json({ error: problem.error }, { status: problem.status });

  const ins = await admin.from("claude_seat_actions").insert({ ...input, requested_by: auth.userId, requested_by_email: auth.email ?? "" }).select("*").single();
  if (ins.error) {
    // 부분 유니크 인덱스에 걸리면(동시 클릭) 409
    const dup = ins.error.code === "23505";
    return NextResponse.json({ error: dup ? "이미 대기·실행 중인 요청이 있습니다." : ins.error.message }, { status: dup ? 409 : 500 });
  }
  const row = ins.data as SeatAction;
  await logAudit(admin, request, { userId: auth.userId, userEmail: auth.email, action: input.action === "unassign" ? "시트 해제 요청" : "시트 할당 요청", category: "usage", detail: { action_id: row.id, org_id: row.org_id, email: row.email, action: row.action, target_tier: row.target_tier } });
  return NextResponse.json({ row }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
  const cur = await admin.from("claude_seat_actions").select("*").eq("id", id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500 });
  if (!cur.data) return NextResponse.json({ error: "요청이 없습니다." }, { status: 404 });
  const row = cur.data as SeatAction;
  if (!canTransition(row.status, "cancelled")) return NextResponse.json({ error: `취소할 수 없는 상태입니다(${row.status}).` }, { status: 409 });
  const upd = await admin.from("claude_seat_actions").update({ status: "cancelled", finished_at: new Date().toISOString() }).eq("id", id).eq("status", "requested").select("*").maybeSingle();
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 });
  if (!upd.data) return NextResponse.json({ error: "이미 실행이 시작됐습니다." }, { status: 409 });
  await logAudit(admin, request, { userId: auth.userId, userEmail: auth.email, action: "시트 작업 취소", category: "usage", detail: { action_id: id, org_id: row.org_id, email: row.email, action: row.action } });
  return NextResponse.json({ row: upd.data });
}

export async function PATCH(request: NextRequest) {
  if (!isExecutor(request)) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401, headers: NO_STORE });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const admin = c.admin;
  const b = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown; before_tier?: unknown; after_tier?: unknown; error?: unknown; executor?: unknown } | null;
  const id = typeof b?.id === "string" ? b.id : "";
  const status = b?.status === "done" || b?.status === "failed" ? (b.status as SeatActionStatus) : null;
  if (!id || !status) return NextResponse.json({ error: "id와 status(done|failed)가 필요합니다." }, { status: 400, headers: NO_STORE });

  const cur = await admin.from("claude_seat_actions").select("*").eq("id", id).maybeSingle();
  if (cur.error) return NextResponse.json({ error: cur.error.message }, { status: 500, headers: NO_STORE });
  if (!cur.data) return NextResponse.json({ error: "요청이 없습니다." }, { status: 404, headers: NO_STORE });
  const row = cur.data as SeatAction;
  if (!canTransition(row.status, status)) return NextResponse.json({ error: `${row.status}에서 ${status}로 바꿀 수 없습니다.` }, { status: 409, headers: NO_STORE });

  const s = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
  const before = b?.before_tier == null ? null : normalizeTier(b.before_tier);
  const after = b?.after_tier == null ? null : normalizeTier(b.after_tier);
  if (status === "done" && after == null) return NextResponse.json({ error: "done에는 after_tier가 필요합니다." }, { status: 400, headers: NO_STORE });
  const upd = await admin.from("claude_seat_actions")
    .update({ status, finished_at: new Date().toISOString(), before_tier: before, after_tier: after, error: status === "failed" ? s(b?.error, 500) ?? "실패" : null, executor: s(b?.executor, 80) })
    .eq("id", id).eq("status", "running").select("*").maybeSingle();
  if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500, headers: NO_STORE });
  if (!upd.data) return NextResponse.json({ error: "이미 끝난 요청입니다." }, { status: 409, headers: NO_STORE });

  if (status === "done" && after) {
    // claude_org_members는 09:05 일 배치로도 새로고침되는 캐시 — 갱신 실패해도 PATCH 자체는 성공시킨다(이미 claude.ai 쪽은 바뀐 뒤). 매치되는 행이 없어도(퇴사 등) 정상
    const memberUpd = await admin.from("claude_org_members").update({ seat_tier: after }).eq("org_id", row.org_id).eq("email", row.email);
    if (memberUpd.error) console.warn(`[claude-usage] claude_org_members 티어 갱신 실패: ${memberUpd.error.message}`);
  }
  const what = row.action === "unassign" ? "시트 해제" : "시트 할당";
  await logAudit(admin, request, {
    userId: row.requested_by, userEmail: row.requested_by_email,
    action: status === "done" ? `${what} 완료` : `${what} 실패`, category: "usage",
    detail: { action_id: id, org_id: row.org_id, email: row.email, action: row.action, target_tier: row.target_tier, before_tier: before, after_tier: after, error: status === "failed" ? s(b?.error, 500) : undefined },
  });
  return NextResponse.json({ row: upd.data }, { headers: NO_STORE });
}
