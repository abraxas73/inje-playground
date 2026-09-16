import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, adminClientOr500, isYmd, numify } from "@/lib/claude-usage/require-admin";
import { dateRangePreset } from "@/lib/claude-usage/aggregate";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ID_RE = /^[A-Za-z0-9_-]{4,128}$/;

/**
 * GET ?from&to — 계정 미식별(SDK) 식별자 매핑과 후보 목록(기간 내 사용량 + 가장 많이 쓴 실행 환경).
 * PUT { user_id, email, note? } — 매핑 등록·수정. DELETE ?user_id= — 매핑 해제.
 * 매핑하면 요약·프롬프트 화면에서 그 식별자의 사용량이 사람의 이메일로 합쳐진다(조직은 그대로 "조직 미확인").
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const sp = request.nextUrl.searchParams;
  const preset = dateRangePreset("90d");
  const from = isYmd(sp.get("from")) ? (sp.get("from") as string) : preset.from;
  const to = isYmd(sp.get("to")) ? (sp.get("to") as string) : preset.to;

  const [mappings, candidates] = await Promise.all([
    c.admin.from("claude_code_identity_map").select("user_id, email, note, updated_at").order("email"),
    c.admin.rpc("claude_code_accountless_candidates", { p_from: from, p_to: to }),
  ]);
  if (mappings.error) return NextResponse.json({ error: mappings.error.message }, { status: 500 });
  if (candidates.error) console.warn("[claude-usage] accountless candidates skipped:", candidates.error.message);
  const rows = (candidates.error ? [] : candidates.data ?? []) as Record<string, unknown>[];
  return NextResponse.json({
    range: { from, to },
    mappings: mappings.data ?? [],
    candidates: rows.slice(0, 100).map((r) => numify(r)),
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { user_id?: unknown; email?: unknown; note?: unknown } | null;
  const userId = typeof body?.user_id === "string" ? body.user_id.trim().replace(/^id:/, "") : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!ID_RE.test(userId)) return NextResponse.json({ error: "식별자를 확인해 주세요." }, { status: 400 });
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: "이메일 형식을 확인해 주세요." }, { status: 400 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { data, error } = await c.admin.from("claude_code_identity_map")
    .upsert({ user_id: userId, email, note: typeof body?.note === "string" ? body.note.trim().slice(0, 200) || null : null, updated_at: new Date().toISOString(), updated_by: auth.userId }, { onConflict: "user_id" })
    .select("user_id, email, note, updated_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mapping: data });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const userId = (request.nextUrl.searchParams.get("user_id") ?? "").replace(/^id:/, "");
  if (!ID_RE.test(userId)) return NextResponse.json({ error: "식별자를 확인해 주세요." }, { status: 400 });
  const c = adminClientOr500();
  if (!c.ok) return c.response;
  const { error } = await c.admin.from("claude_code_identity_map").delete().eq("user_id", userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
