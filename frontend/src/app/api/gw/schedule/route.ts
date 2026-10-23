import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { callApp } from "@/lib/gw/mail";
import { parseEvents, scheduleDate } from "@/lib/gw/agenda";

export const runtime = "nodejs";
export const maxDuration = 120;
const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/gw/schedule?date=YYYY-MM-DD — 그날 일정(데스크톱 앱 중계 list_events, 읽기 전용, 오늘 KST ±7일). 앱 미실행이면 409 `no_app`. */
export async function GET(req: Request) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const date = scheduleDate(new URL(req.url).searchParams.get("date"));
  if (!date) return NextResponse.json({ error: "date는 오늘 기준 ±7일 안의 YYYY-MM-DD여야 합니다." }, { status: 400, headers: NO_STORE });
  const ymd = date.replace(/-/g, "");
  const res = await callApp(r.admin, r.userId, "list_events", { start: ymd, end: ymd });
  if (!res.ok) return NextResponse.json({ error: res.message, code: res.code }, { status: res.code === "no_app" ? 409 : 502, headers: NO_STORE });
  return NextResponse.json({ date, events: parseEvents(res.data) }, { headers: NO_STORE });
}
