import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { analyzeTodo, kstToday, TODO_AI_DAILY_LIMIT, TODO_TEXT_MAX, todoAiEnabled, todoModel } from "@/lib/todo/ai";

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { "Cache-Control": "no-store" };
const ANALYZE_ACTION = "할 일 AI 분석";

/** GET — 앱이 AI 버튼을 그릴지(ANTHROPIC_API_KEY가 없으면 숨김). 권한은 proxy가 /api/todo → todo로 본다. */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  return NextResponse.json({ enabled: todoAiEnabled() }, { headers: noStore });
}

/**
 * POST {text} — 할 일 한 줄을 Claude로 파싱·분류해 제안만 돌려준다(저장 안 함). 문장·결과는 저장·로그하지 않고 감사엔 글자 수만.
 * 응답 {title, scheduled_for(UTC ISO|null), estimated_minutes, priority, context_tags}.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  if (!todoAiEnabled()) return NextResponse.json({ error: "AI 분석이 설정되지 않았습니다.", code: "todo_ai_disabled" }, { status: 503, headers: noStore });
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "분석할 글이 없습니다." }, { status: 400, headers: noStore });
  if (text.length > TODO_TEXT_MAX) return NextResponse.json({ error: `${TODO_TEXT_MAX}자 이하로 입력하세요.` }, { status: 413, headers: noStore });
  // 하루(KST) 상한 — 모델을 부르기 전에 한 칸을 원자적으로 예약한다(동시 요청·실패한 시도도 센다). 예약을 못 하면 닫힌 쪽으로
  const { data: uses, error: reserveError } = await r.admin.rpc("todo_ai_reserve", { p_user: r.userId, p_day: kstToday(), p_limit: TODO_AI_DAILY_LIMIT });
  if (reserveError) return NextResponse.json({ error: "잠시 후 다시 시도하세요." }, { status: 503, headers: noStore });
  if (typeof uses !== "number") return NextResponse.json({ error: `AI 분석은 하루 ${TODO_AI_DAILY_LIMIT}번까지입니다. 내일 다시 쓸 수 있어요.`, code: "todo_ai_daily_limit" }, { status: 429, headers: noStore });
  try {
    const analysis = await analyzeTodo(text);
    await logAudit(r.admin, request, { userId: r.userId, action: ANALYZE_ACTION, category: "todo", detail: { chars: text.length, model: todoModel() } });
    return NextResponse.json(analysis, { headers: noStore });
  } catch (e) {
    console.error("[todo] AI 분석 실패:", e instanceof Error ? e.message : "unknown");
    return NextResponse.json({ error: "AI 분석에 실패했습니다. 잠시 후 다시 시도하세요." }, { status: 502, headers: noStore });
  }
}
