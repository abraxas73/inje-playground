import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { logAudit } from "@/lib/audit";
import { loadConnection } from "@/lib/dooray/connection";
import { DoorayError, doorayRequest } from "@/lib/dooray/client";
import { messageSchema, searchMembers, sendMessage } from "@/lib/dooray/messenger";
import { doorayFailure, doorayJson } from "@/lib/dooray/route";
export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const c = await loadConnection(auth.admin, auth.userId);
    if (!c) throw new DoorayError("Dooray 계정을 연결해 주세요.", 409, "reconnect");
    const items = await searchMembers(doorayRequest(c.token, request.signal), request.nextUrl.searchParams.get("q") ?? "");
    const current = await loadConnection(auth.admin, auth.userId);
    if (!current || current.token !== c.token) throw new DoorayError("연결이 변경됐습니다. 다시 조회해 주세요.", 409, "reconnect");
    return doorayJson({ items });
  } catch (e) { return doorayFailure(e); }
}
export async function POST(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const raw = await request.text();
    if (raw.length > 30000) throw new DoorayError("메시지가 너무 깁니다.", 400, "input");
    let json: unknown; try { json = JSON.parse(raw); } catch { throw new DoorayError("입력값이 올바르지 않습니다.", 400, "input"); }
    const body = messageSchema.safeParse(json);
    if (!body.success) throw new DoorayError("받는 사람과 메시지(최대 4,000자)를 확인해 주세요.", 400, "input");
    const c = await loadConnection(auth.admin, auth.userId);
    if (!c) throw new DoorayError("Dooray 계정을 연결해 주세요.", 409, "reconnect");
    // Dooray enforces channel membership and recipient access using the caller's personal token.
    await sendMessage(doorayRequest(c.token), body.data);
    // A post-send audit failure must not prompt the user to send the same message twice.
    try { await logAudit(auth.admin, request, { userId: auth.userId, action: "Dooray 메시지 전송", category: "dooray", detail: { kind: body.data.kind, targetId: body.data.id } }); }
    catch { console.warn("Dooray message audit failed"); }
    return doorayJson({ sent: true });
  } catch (e) { return doorayFailure(e); }
}
