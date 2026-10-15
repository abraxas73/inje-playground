import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { SERVER_TOOLS } from "@/lib/assistant/tools";
import { loadAssistantSettings } from "@/lib/assistant/settings";
import { runServerTool } from "@/lib/assistant/server-tools";

export const runtime = "nodejs";

/** POST /api/assistant/execute — 앱 이노봇의 서버 도구 실행. 쓰기는 앱이 확인 카드를 받은 뒤에만 부른다. 결과는 {ok,result}|{ok:false,error}(도구 결과로 Claude에 간다). */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const body = (await request.json().catch(() => ({}))) as { tool?: unknown; args?: unknown };
  const tool = typeof body.tool === "string" ? body.tool : "";
  if (!(SERVER_TOOLS as readonly string[]).includes(tool)) return NextResponse.json({ error: "지원하지 않는 도구입니다." }, { status: 400 });
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ enabled: false });
  const args = (body.args && typeof body.args === "object" ? body.args : {}) as Record<string, unknown>;
  const run = await runServerTool(r.admin, r.userId, r.role, tool, args);
  if (run.ok) await logAudit(r.admin, request, { userId: r.userId, action: "비서 실행", category: "assistant", detail: { tool } });
  return NextResponse.json(run);
}
