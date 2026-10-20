import { NextRequest, NextResponse } from "next/server";
import { bad, caller } from "@/lib/proposal/api";
import { PROFILE_COLUMNS } from "@/lib/proposal/core";

/** PATCH {hidden} — 숨기기·다시 보이기(올린 사람 또는 관리자). 삭제는 없다(옛 결과가 참조) */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await caller();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const b = (await request.json().catch(() => ({}))) as { hidden?: unknown };
  if (typeof b.hidden !== "boolean" || !/^[0-9a-f-]{36}$/.test(id)) return bad("hidden이 필요합니다.");
  const { data: row } = await auth.admin.from("proposal_profiles").select("uploaded_by").eq("id", id).maybeSingle();
  if (!row) return bad("없는 버전입니다.", 404);
  if (row.uploaded_by !== auth.userId && auth.role !== "admin") return bad("올린 사람이나 관리자만 숨길 수 있습니다.", 403);
  const { data, error } = await auth.admin.from("proposal_profiles").update({ hidden: b.hidden }).eq("id", id).select(PROFILE_COLUMNS).single();
  if (error) return bad("저장하지 못했습니다.", 500);
  return NextResponse.json({ item: data });
}
