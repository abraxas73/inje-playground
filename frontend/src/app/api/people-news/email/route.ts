import { NextRequest, NextResponse } from "next/server";
import { requireNewsUser } from "@/lib/people-news/auth";
import { callYonhapFunction } from "@/lib/people-news/edge";

export const maxDuration = 90;
const headers = { "Cache-Control": "private, no-store" };

/** ?excludeSent=1|0 — 생략하면 사용자의 저장된 "이전 발송 내역 제외" 설정을 따른다. */
function excludeSentParam(request: NextRequest): boolean | undefined {
  const raw = request.nextUrl.searchParams.get("excludeSent");
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  return undefined;
}

/** 읽기 전용 미리보기: Edge Function이 실제 발송과 같은 구간·양식으로 만든다. 발송·슬롯 소비 없음. */
export async function GET(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  const excludeSent = excludeSentParam(request);
  const result = await callYonhapFunction(auth.supabase, "preview", { timeoutMs: 30_000, failureMessage: "메일 미리보기를 불러오지 못했습니다.", payload: excludeSent === undefined ? undefined : { excludeSent } });
  return NextResponse.json(result.body, { status: result.status, headers });
}

/** 지금 수신: Edge Function이 본인 세션으로 claim(1분 쿨다운)하고 SMTP 릴레이로 로그인 이메일에 보낸다. 본문은 무시한다. */
export async function POST(request: NextRequest) {
  const auth = await requireNewsUser();
  if (!auth.ok) return auth.response;
  if (!auth.user.email || !auth.user.email_confirmed_at) return NextResponse.json({ error: "계정 이메일 인증이 필요합니다." }, { status: 400, headers });
  const excludeSent = excludeSentParam(request);
  const result = await callYonhapFunction(auth.supabase, "send-now", { timeoutMs: 80_000, failureMessage: "메일 발송을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.", payload: excludeSent === undefined ? undefined : { excludeSent } });
  return NextResponse.json(result.body, { status: result.status, headers: result.retryAfter ? { ...headers, "Retry-After": result.retryAfter } : headers });
}
