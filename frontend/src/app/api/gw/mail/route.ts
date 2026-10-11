import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { callApp, parseInbox } from "@/lib/gw/mail";

export const runtime = "nodejs";
export const maxDuration = 120;
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/gw/mail — 받은메일 최근 20통(데스크톱 앱 중계 list_mail_inbox). 앱 미실행이면 409 `no_app`. 본문·인자는 기록하지 않는다. */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const res = await callApp(r.admin, r.userId, "list_mail_inbox", {});
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "no_app" ? 409 : 502, headers: NO_STORE });
  return NextResponse.json(parseInbox(res.data), { headers: NO_STORE });
}
