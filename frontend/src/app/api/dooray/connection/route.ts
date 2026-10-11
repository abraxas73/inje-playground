import { NextRequest } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { logAudit } from "@/lib/audit";
import { connectionStatus, saveConnection } from "@/lib/dooray/connection";
import { doorayFailure, doorayJson } from "@/lib/dooray/route";
import { DoorayError } from "@/lib/dooray/client";
export const runtime = "nodejs";
export async function GET() {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try { return doorayJson(await connectionStatus(auth.admin, auth.userId)); } catch (e) { return doorayFailure(e); }
}
export async function PUT(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const raw = await request.text();
    if (raw.length > 4096) throw new DoorayError("입력값이 너무 큽니다.", 400, "input");
    let body;
    try { body = JSON.parse(raw); } catch { throw new DoorayError("입력값이 올바르지 않습니다.", 400, "input"); }
    const token = body?.token;
    if (typeof token !== "string" || token.length < 10 || token.length > 2000 || /\s/.test(token)) throw new DoorayError("개인 API 토큰을 확인해 주세요.", 400, "input");
    await saveConnection(auth.admin, auth.userId, token);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Dooray 계정 연결", category: "auth" });
    return doorayJson(await connectionStatus(auth.admin, auth.userId));
  } catch (e) { return doorayFailure(e); }
}
export async function DELETE(request: NextRequest) {
  const auth = await requireUser(); if (!auth.ok) return auth.response;
  try {
    const { error } = await auth.admin.from("dooray_connections").delete().eq("user_id", auth.userId);
    if (error) throw new DoorayError("Dooray 연결을 해제하지 못했습니다.", 503);
    await logAudit(auth.admin, request, { userId: auth.userId, action: "Dooray 계정 연결 해제", category: "auth" });
    return doorayJson({ connected: false });
  } catch (e) { return doorayFailure(e); }
}
