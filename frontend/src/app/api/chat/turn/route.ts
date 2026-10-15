import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { canUsePage } from "@/lib/page-access";
import { loadAssistantSettings, pickModel } from "@/lib/assistant/settings";
import { runServerTool } from "@/lib/assistant/server-tools";
import { streamAssistant } from "@/lib/assistant/llm";
import { relayToolCall } from "@/lib/mcp/relay";
import { recordUsage, turnsToday } from "@/lib/chat/usage";
import { loadPermissions } from "@/lib/chat/access";
import { attachmentLoader } from "@/lib/chat/attachments";
import { supabaseChatStore } from "@/lib/chat/store";
import { parseTurnBody, runTurn, TurnInputError, type TurnDeps } from "@/lib/chat/engine";
import { sseLine, type ChatEvent } from "@/lib/chat/events";

export const runtime = "nodejs";
export const maxDuration = 800; // ppt_create가 after()로 덱 생성을 이어 돈다(PPT 만들기와 같은 상한)
const BODY_MAX = 512 * 1024;
const NO_STORE = { "Cache-Control": "no-store" };
const NOW_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\+09:00)?$/;

/**
 * POST /api/chat/turn — 웹·앱 공용 이노봇 한 턴(설계서 §1.4). 거버넌스(권한·모델·상한)는 스트림을 열기 전에 JSON으로 거절하고,
 * 그 뒤는 SSE 이벤트(conversation·text·tool·masked·needs_action·done·error). 본문·인자는 기록하지 않는다.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > BODY_MAX) return NextResponse.json({ error: "요청이 너무 큽니다." }, { status: 400 });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ error: "JSON 형식이 아닙니다." }, { status: 400 }); }
  const parsed = parseTurnBody(json);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const b = parsed.body;
  const cfg = await loadAssistantSettings(r.admin);
  if (!cfg.ok) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!cfg.enabled) return NextResponse.json({ error: "관리자가 이노봇을 꺼 두었습니다.", code: "assistant_disabled" }, { status: 403 });
  const perms = await loadPermissions(r.admin, r.userId);
  if (!perms) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (!canUsePage(r.role, "assistant", perms)) return NextResponse.json({ error: "이노봇 권한이 없습니다." }, { status: 403 });
  // 확인 후 기록이라 원자적이지 않다 — 동시 요청에서 상한을 조금 넘을 수 있으나 허용한다.
  const used = await turnsToday(r.admin, r.userId);
  if (used === null) return NextResponse.json({ error: "assistant unavailable" }, { status: 503 });
  if (used >= cfg.dailyLimit) return NextResponse.json({ error: "오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요." }, { status: 429 });
  const { data: profile } = await r.admin.from("user_profiles").select("display_name,email").eq("user_id", r.userId).maybeSingle();
  const p = (profile ?? {}) as { display_name?: string | null; email?: string | null };
  const model = pickModel(b.model, cfg.models);
  const now = b.now && NOW_RE.test(b.now) ? b.now : new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);

  const deps: TurnDeps = {
    store: supabaseChatStore(r.admin),
    allowed: (k) => canUsePage(r.role, k, perms),
    retentionDays: cfg.retentionDays,
    stream: streamAssistant,
    runServer: (tool, args) => runServerTool(r.admin, r.userId, r.role, tool, args),
    runRelay: async (tool, args) => {
      const x = await relayToolCall({ admin: r.admin }, r.userId, tool, args);
      const text = x.content.map((c) => c.text).join("\n");
      if (x.isError) return { ok: false, error: text };
      try { return { ok: true, result: JSON.parse(text) }; } catch { return { ok: true, result: text }; }
    },
    loadAttachments: attachmentLoader(r.admin, r.userId),
    recordUsage: (u) => recordUsage(r.admin, { userId: r.userId, ...u }),
    audit: (detail) => logAudit(r.admin, request, { userId: r.userId, action: "비서 턴", category: "assistant", detail }),
    signal: request.signal,
  };
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: ChatEvent) => { try { ctrl.enqueue(enc.encode(sseLine(e))); } catch { /* 연결이 끊김 */ } };
      try {
        await runTurn(deps, { userId: r.userId, name: p.display_name ?? "", email: p.email ?? "", client: b.client, conversationId: b.conversationId, text: b.text, attachmentIds: b.attachmentIds, actions: b.actions, retry: b.retry, model, ephemeral: b.ephemeral, desktopOnline: b.desktopOnline, now }, emit);
      } catch (e) {
        if (!(e instanceof TurnInputError)) console.error("[chat] 턴 실패:", e instanceof Error ? e.message.slice(0, 200) : e);
        emit({ type: "error", message: e instanceof TurnInputError ? e.message : "이노봇이 답하지 못했습니다. 다시 시도해 주세요.", retryable: !(e instanceof TurnInputError) });
      } finally {
        try { ctrl.close(); } catch { /* 이미 닫힘 */ }
      }
    },
  });
  return new Response(stream, { headers: { ...NO_STORE, "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" } });
}
