import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { loadDirectory, noStore } from "@/lib/media-directory/server";

export async function GET(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await loadDirectory(auth.supabase, request.nextUrl.searchParams.get("q") ?? ""), noStore);
  } catch (e) {
    console.error("[media-directory] 조회 실패", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "매체·부서 목록을 불러오지 못했습니다." }, { status: 500 });
  }
}
