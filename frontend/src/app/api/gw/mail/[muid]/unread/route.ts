import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { MUID_RE, callApp } from "@/lib/gw/mail";

export const runtime = "nodejs";
export const maxDuration = 120;
const NO_STORE = { "Cache-Control": "no-store" };
type Params = { params: Promise<{ muid: string }> };

/** POST /api/gw/mail/[muid]/unread — 안 읽음으로 되돌리기(mark_mail_unread, 받은메일함 최근 200건 안에서만). */
export async function POST(_req: NextRequest, { params }: Params) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { muid } = await params;
  if (!MUID_RE.test(muid)) return NextResponse.json({ error: "메일 번호가 올바르지 않습니다." }, { status: 400, headers: NO_STORE });
  const res = await callApp(r.admin, r.userId, "mark_mail_unread", { muid });
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "no_app" ? 409 : 502, headers: NO_STORE });
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
