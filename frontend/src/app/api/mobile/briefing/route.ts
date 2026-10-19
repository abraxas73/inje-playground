import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { BRIEFING_BODY_MAX, briefingEnabled, countsOf, MOBILE_BRIEFING_LLM_KEY, sanitizePayload } from "@/lib/mobile/briefing";
import { generateBriefing } from "@/lib/mobile/briefing-llm";
import { briefingFailure } from "@/lib/mobile/briefing-error";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/mobile/briefing — 홈 "오늘의 한 마디". 앱이 보낸 제목 수준 payload(≤16KB)를 서버가 다시 자르고 Claude(Sonnet 5.5, thinking 없음)에
 * 평문 2~3문장을 받는다. settings mobile_briefing_llm=off 또는 ANTHROPIC_API_KEY 없음 → {enabled:false}. payload·문장은 저장·로그하지 않고 감사에는 건수만.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const raw = await request.text();
  if (raw.length > BRIEFING_BODY_MAX) return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 400 });
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON 형식이 아닙니다." }, { status: 400 }); }
  const payload = sanitizePayload(parsed);
  const { data } = await r.admin.from("settings").select("value").eq("key", MOBILE_BRIEFING_LLM_KEY).maybeSingle();
  const setting = (data as { value?: string } | null)?.value;
  if (!briefingEnabled(setting, process.env.ANTHROPIC_API_KEY)) {
    const disabled = setting?.trim().toLowerCase() === "off";
    return NextResponse.json({ enabled: false, code: disabled ? "briefing_disabled" : "briefing_configuration" }, { headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { text, model } = await generateBriefing(payload);
    await logAudit(r.admin, request, { userId: r.userId, action: "모바일 브리핑 생성", category: "mobile", detail: { ...countsOf(payload), model } });
    return NextResponse.json({ enabled: true, text, model, at: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const { status, ...failure } = briefingFailure(e);
    console.error("[mobile] 브리핑 생성 실패:", failure.code);
    return NextResponse.json(failure, { status, headers: { "Cache-Control": "no-store" } });
  }
}
