import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { CHAT_FILE_MAX_BYTES, createChatUpload } from "@/lib/teams/chat-files";
import { graphErrorResponse } from "@/lib/teams/chat-route";
import { GraphError } from "@/lib/ms/graph-drive";

export const runtime = "nodejs";

/** POST /api/teams/chat/upload {name, size} — 내 OneDrive "Microsoft Teams Chat Files"에 올릴 업로드 세션 주소. 바이트는 화면이 그 주소에 직접 올린다(서버 미경유) */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; size?: unknown };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!name) return NextResponse.json({ error: "파일 이름이 없습니다." }, { status: 400 });
  if (!Number.isInteger(size) || size <= 0) return NextResponse.json({ error: "빈 파일은 보낼 수 없습니다." }, { status: 400 });
  if (size > CHAT_FILE_MAX_BYTES) return NextResponse.json({ error: `파일은 ${CHAT_FILE_MAX_BYTES / 1024 / 1024}MB까지 보낼 수 있습니다.` }, { status: 400 });
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok.response;
  try {
    return NextResponse.json(await createChatUpload(tok.token, name), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    // OneDrive 쓰기 거절은 Teams 채팅 재연결 안내가 맞지 않다 — 파일 권한(Files.ReadWrite.All) 안내로
    if (e instanceof GraphError && (e.status === 401 || e.status === 403)) return NextResponse.json({ error: "OneDrive에 파일을 올릴 권한이 없습니다. 설정에서 Microsoft 계정을 다시 연결해 주세요." }, { status: 409 });
    return graphErrorResponse(e);
  }
}
