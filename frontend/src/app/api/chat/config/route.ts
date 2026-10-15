import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { loadAssistantSettings, pickModel } from "@/lib/assistant/settings";

export const runtime = "nodejs";
/** GET /api/chat/config — 채팅 화면의 모델 선택지·켜짐 여부. */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  return NextResponse.json({ enabled: cfg.enabled, models: cfg.models, defaultModel: pickModel(undefined, cfg.models) }, { headers: { "Cache-Control": "no-store" } });
}
