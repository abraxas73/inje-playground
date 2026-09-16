import { NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { callYonhapFunction } from "@/lib/people-news/edge";

export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };

/** 읽기 전용 미리보기: Edge Function이 실제 발송과 같은 양식으로 최근 24시간 수집분을 만든다. 발송·슬롯 소비 없음. */
export async function GET() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  const result = await callYonhapFunction(auth.supabase, "preview", { timeoutMs: 30_000, failureMessage: "메일 미리보기를 불러오지 못했습니다." });
  return NextResponse.json(result.body, { status: result.status, headers });
}

/** 지금 수신: Edge Function이 본인 세션으로 claim(1분 쿨다운)하고 SMTP 릴레이로 로그인 이메일에 보낸다. 본문은 무시한다. */
export async function POST() {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  if (!auth.user.email || !auth.user.email_confirmed_at) return NextResponse.json({ error: "계정 이메일 인증이 필요합니다." }, { status: 400, headers });
  const result = await callYonhapFunction(auth.supabase, "send-now", { timeoutMs: 80_000, failureMessage: "메일 발송을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요." });
  return NextResponse.json(result.body, { status: result.status, headers: result.retryAfter ? { ...headers, "Retry-After": result.retryAfter } : headers });
}
