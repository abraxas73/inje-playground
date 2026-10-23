import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { callApp } from "@/lib/gw/mail";
import { parseApprovals } from "@/lib/gw/agenda";

export const runtime = "nodejs";
export const maxDuration = 120;
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/gw/approvals — 내 미결 결재(데스크톱 앱 중계 pending_approvals, 읽기 전용). 앱 미실행이면 409 `no_app`. 결과 원문은 기록하지 않는다. */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const res = await callApp(r.admin, r.userId, "pending_approvals", { page_size: 50 });
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "no_app" ? 409 : 502, headers: NO_STORE });
  return NextResponse.json(parseApprovals(res.data), { headers: NO_STORE });
}
