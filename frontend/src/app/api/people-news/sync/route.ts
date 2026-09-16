import { NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { callYonhapFunction } from "@/lib/people-news/edge";

export const maxDuration = 60;

export async function POST() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  // requireNewsUser verified this session; the Edge Function independently verifies it again.
  const result = await callYonhapFunction(auth.supabase, "collect", { timeoutMs: 50_000, failureMessage: "수집 결과를 확인하지 못했습니다. 잠시 후 목록을 새로고침해 주세요." });
  if (result.status >= 400) {
    return NextResponse.json({ error: (result.body.error as string | undefined) ?? "지금 가져오기에 실패했습니다." }, {
      status: result.status,
      headers: result.status === 429 ? { "Retry-After": "60" } : undefined,
    });
  }
  return NextResponse.json({ ok: true, count: result.body.count }, { headers: { "Cache-Control": "no-store" } });
}
