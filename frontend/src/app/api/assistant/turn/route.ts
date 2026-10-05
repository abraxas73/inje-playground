import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { ASSISTANT_BODY_MAX, assistantSystemPrompt, kstDayStartIso, validateMessages } from "@/lib/assistant/tools";
import { loadAssistantSettings } from "@/lib/assistant/settings";
import { callAssistant } from "@/lib/assistant/llm";

export const runtime = "nodejs";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };
const TURN_ACTION = "비서 턴";

/**
 * POST /api/assistant/turn — 모바일 비서 한 턴. {messages, now} → Claude 한 번 → {enabled, message, stop_reason}.
 * 무상태 중계: 대화·도구 결과는 저장·로그하지 않는다(감사엔 이번 응답의 도구 이름만). 도구 실행은 앱(아마란스)·/api/assistant/execute(Teams).
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > ASSISTANT_BODY_MAX) return NextResponse.json({ error: "대화가 너무 깁니다. 새 대화를 시작해 주세요." }, { status: 400 });
  let parsed: { messages?: unknown; now?: unknown };
  try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON 형식이 아닙니다." }, { status: 400 }); }
  const messages = validateMessages(parsed.messages);
  if (!messages) return NextResponse.json({ error: "대화 형식이 올바르지 않습니다." }, { status: 400 });
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ enabled: false }, { headers: NO_STORE });
  // 확인 후 기록이라 원자적이지 않다 — 동시 요청에서 상한을 조금 넘을 수 있으나 허용한다.
  const { count, error: countErr } = await r.admin.from("action_history").select("id", { count: "exact", head: true }).eq("user_id", r.userId).eq("action", TURN_ACTION).gte("created_at", kstDayStartIso(new Date()));
  if (countErr) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if ((count ?? 0) >= cfg.dailyLimit) return NextResponse.json({ error: "오늘 비서 사용 한도를 넘었습니다. 내일 다시 이용해 주세요." }, { status: 429 });
  const { data: profile } = await r.admin.from("user_profiles").select("display_name,email").eq("user_id", r.userId).maybeSingle();
  const p = (profile ?? {}) as { display_name?: string | null; email?: string | null };
  const now = typeof parsed.now === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+09:00)?$/.test(parsed.now) ? parsed.now : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
  try {
    const msg = await callAssistant(messages, assistantSystemPrompt({ now, name: p.display_name ?? "", email: p.email ?? "" }));
    const tools = msg.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name);
    await logAudit(r.admin, request, { userId: r.userId, action: TURN_ACTION, category: "assistant", detail: { tools } });
    return NextResponse.json({ enabled: true, message: { role: "assistant", content: msg.content }, stop_reason: msg.stop_reason }, { headers: NO_STORE });
  } catch (e) {
    console.error("[assistant] 턴 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
    return NextResponse.json({ error: "비서가 답하지 못했습니다. 잠시 후 다시 시도해 주세요." }, { status: 502 });
  }
}
