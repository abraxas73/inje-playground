import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { DESKTOP_RELEASE_KEY, parseDesktopRelease } from "@/lib/desktop/release";
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data, error } = await r.admin.from("settings").select("value").eq("key", DESKTOP_RELEASE_KEY).maybeSingle();
  if (error) return NextResponse.json({ error: "배포 정보를 불러오지 못했습니다." }, { status: 503 });
  return NextResponse.json(parseDesktopRelease(data?.value), { headers: { "Cache-Control": "no-store" } });
}
