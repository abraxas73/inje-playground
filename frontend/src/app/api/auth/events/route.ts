import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase-admin";
import { createServerSupabase } from "@/lib/supabase-server";
import { isAuthEvent, logAuthEvent, requestContext } from "@/lib/audit";

export const runtime = "nodejs";

/** 같은 IP에서 5분 안에 이만큼 쌓이면 더 남기지 않는다(공개 엔드포인트 도배 방지) */
const IP_WINDOW_MIN = 5;
const IP_LIMIT = 30;

/**
 * POST /api/auth/events {event: "attempt"|"failure"|"blocked", provider?, email?, reason?}
 *
 * **로그인 전(익명)** 에도 부를 수 있는 유일한 감사 기록 경로 — 로그인 화면의 시도와 실패를 남긴다.
 * 성공한 로그인은 여기가 아니라 `/auth/callback`이 `login_history`에 남긴다.
 * 공개 엔드포인트라 값은 화이트리스트(event·provider)만 받고, IP당 도배를 막고, 본문은 저장하지 않는다.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !isAuthEvent(body.event)) {
    return NextResponse.json({ error: "event는 attempt·failure·blocked 중 하나입니다." }, { status: 400 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    // 서비스 키가 없으면 조용히 넘긴다 — 로그인 화면이 이 응답 때문에 막히면 안 된다
    return NextResponse.json({ ok: true, skipped: "no-service-key" });
  }

  const { ip } = requestContext(request);
  if (ip) {
    const since = new Date(Date.now() - IP_WINDOW_MIN * 60_000).toISOString();
    const { count } = await admin
      .from("action_history")
      .select("id", { count: "exact", head: true })
      .eq("category", "auth")
      .eq("ip_address", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= IP_LIMIT) return NextResponse.json({ ok: true, skipped: "rate-limited" });
  }

  const reason = typeof body.reason === "string" ? body.reason.slice(0, 200) : null;
  // 이미 로그인된 상태에서 일어난 일(재인증·다른 계정으로 전환 시도 등)이면 그 사용자를 붙인다.
  // 본문의 email은 신뢰하지 않는다 — 세션이 없을 때만 참고값으로 남긴다.
  const session = await createServerSupabase().then((c) => c.auth.getUser()).catch(() => null);
  const user = session?.data.user ?? null;
  const email = user?.email ?? (typeof body.email === "string" ? body.email.slice(0, 200) : null);
  await logAuthEvent(admin, request, { event: body.event, provider: body.provider, userId: user?.id ?? null, email, reason });
  return NextResponse.json({ ok: true });
}
