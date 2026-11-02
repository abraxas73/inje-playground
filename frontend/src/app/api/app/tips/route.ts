import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { parseAppTips } from "@/lib/app-tips";

/** GET /api/app/tips — 앱 홈 상단 팁(가중치 0은 뺌). 관리자 설정 `app_tips`, 없으면 기본 목록. */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { data } = await auth.admin.from("settings").select("value").eq("key", "app_tips").maybeSingle();
  return NextResponse.json({ items: parseAppTips(data?.value).filter((t) => t.weight > 0) });
}
