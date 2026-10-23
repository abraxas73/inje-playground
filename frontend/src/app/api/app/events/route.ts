import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { getNotifier } from "@/lib/notify";
import type { ServerSupabase } from "@/lib/settings-server";
import {
  APP_EVENT_ACTION, APP_EVENT_ALERTS_KEY, GW_ALERT_WINDOW_MS, gwAlertText, parseAppEvents,
} from "@/lib/app-events";

export const runtime = "nodejs";

/** 사용자당 10분에 이만큼까지만 남긴다(오류 반복 폭주 방지) */
const USER_WINDOW_MS = 10 * 60_000;
const USER_LIMIT = 30;

/**
 * POST /api/app/events {events:[{kind, code, version, platform, at?}]} (최대 20개)
 * 앱이 모아 보내는 장애 신호(아마란스 자동 로그인 실패·세션 만료·미처리 예외 타입)를 감사 로그(category app)에 남긴다.
 * 정해진 값만 받는다 — 메시지·스택·아마란스 아이디·토큰·메일은 없다.
 * gw_login_failed가 1시간 안에 서로 다른 사용자 2명 이상이면 관리자 채널 알림(settings notify)을 6시간에 한 번 보낸다.
 */
export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const events = parseAppEvents(await request.json().catch(() => null));
  if (!events) return NextResponse.json({ error: "잘못된 앱 이벤트입니다." }, { status: 400 });
  const { admin, userId } = auth;

  const { count } = await admin
    .from("action_history")
    .select("id", { count: "exact", head: true })
    .eq("category", "app")
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - USER_WINDOW_MS).toISOString());
  const kept = events.slice(0, Math.max(0, USER_LIMIT - (count ?? 0)));
  await Promise.all(kept.map((e) => logAudit(admin, request, { userId, action: APP_EVENT_ACTION[e.kind], category: "app", detail: { ...e } })));

  if (kept.some((e) => e.kind === "gw_login_failed")) {
    try {
      await maybeAlertGwLogin(admin);
    } catch (e) {
      console.error("[app-events] 알림 확인 실패", e instanceof Error ? e.message : e);
    }
  }
  return NextResponse.json({ ok: true, kept: kept.length });
}

// ponytail: 동시에 두 요청이 들어오면 알림이 두 번 갈 수 있다 — 드물고 해가 적어 잠금 없이 둔다.
async function maybeAlertGwLogin(admin: SupabaseClient) {
  const now = Date.now();
  const { data: rows } = await admin
    .from("action_history")
    .select("user_id, detail")
    .eq("category", "app")
    .eq("action", APP_EVENT_ACTION.gw_login_failed)
    .gte("created_at", new Date(now - GW_ALERT_WINDOW_MS).toISOString());
  const { data: setting } = await admin.from("settings").select("value").eq("key", APP_EVENT_ALERTS_KEY).maybeSingle();
  let state: Record<string, string> = {};
  try {
    state = JSON.parse(setting?.value ?? "{}") ?? {};
  } catch {}
  const text = gwAlertText(rows ?? [], state.gw_login_failed, now);
  if (!text) return;
  await admin.from("settings").upsert({ key: APP_EVENT_ALERTS_KEY, value: JSON.stringify({ ...state, gw_login_failed: new Date(now).toISOString() }) }, { onConflict: "key" });
  const notifier = await getNotifier(admin as unknown as ServerSupabase, "notify");
  if (!notifier.channelConfigured) return console.error("[app-events] 관리자 채널 알림이 설정되지 않아 보내지 못했습니다.");
  const r = await notifier.sendChannel({ title: "아마란스 자동 로그인 장애 의심", text });
  if (!r.ok) console.error("[app-events] 알림 발송 실패", r.error);
}
