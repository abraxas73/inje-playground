import { after, NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";
import { graphTokenForRoute } from "@/lib/ms/route-token";
import { fetchMe } from "@/lib/ms/oauth";
import { CHAT_MESSAGE_MAX, listChatMessages, sendChatMessage } from "@/lib/teams/chat";
import { base64Bytes, CHAT_FILES_PER_MESSAGE, CHAT_IMAGE_TYPE_RE, CHAT_IMAGES_MAX_BYTES, CHAT_IMAGES_PER_MESSAGE, DRIVE_ITEM_ID_RE, ChatFileError, prepareChatFiles, sendChatAttachments, type ChatImage } from "@/lib/teams/chat-files";
import { graphErrorResponse, parseChatId } from "@/lib/teams/chat-route";
import { registerCustomReactions } from "@/lib/teams/custom-reactions";

export const runtime = "nodejs";

const badChat = () => NextResponse.json({ error: "채팅을 지정해 주세요(chat)." }, { status: 400 });

async function prepare() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const tok = await graphTokenForRoute(auth.admin, auth.userId);
  if (!tok.ok) return tok;
  return { ok: true as const, admin: auth.admin, userId: auth.userId, token: tok.token };
}

/** GET /api/teams/chat/messages?chat=<id>&since=<ISO> — 최근 50건(오래된 것부터). since가 있으면 그 뒤 수정·생성분만(폴링). 참여 여부는 Graph가 검사한다(미참여 403 → 409). 응답 뒤 처음 본 사용자 정의 반응을 등록한다. */
export async function GET(request: NextRequest) {
  const chatId = parseChatId(request.nextUrl.searchParams.get("chat"));
  if (!chatId) return badChat();
  const since = request.nextUrl.searchParams.get("since") ?? undefined;
  if (since && Number.isNaN(Date.parse(since))) return NextResponse.json({ error: "since 형식이 잘못되었습니다." }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    const messages = await listChatMessages(p.token, chatId, since);
    after(() => registerCustomReactions(p.admin, p.token, chatId, messages).catch(() => 0)); // 처음 본 사용자 정의 반응을 등록부에(고르기 창용, 응답을 늦추지 않게)
    return NextResponse.json({ messages }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return graphErrorResponse(e);
  }
}

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * POST /api/teams/chat/messages {chat, text, images?, files?} — 본인 이름으로 전송. 감사 로그에는 글자 수·첨부 수만.
 * images: [{type, data(base64)}] 본문 그림(합계 3MB·4장), files: 내 OneDrive에 올린 항목 id(`/upload` 세션으로 올린 것, 10개).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { chat?: unknown; text?: unknown; images?: unknown; files?: unknown };
  const chatId = parseChatId(body.chat);
  if (!chatId) return badChat();
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > CHAT_MESSAGE_MAX) return NextResponse.json({ error: `메시지는 ${CHAT_MESSAGE_MAX}자까지 보낼 수 있습니다.` }, { status: 400 });
  const images = Array.isArray(body.images) ? (body.images as ChatImage[]) : [];
  const files = Array.isArray(body.files) ? (body.files as unknown[]) : [];
  if (images.length > CHAT_IMAGES_PER_MESSAGE) return NextResponse.json({ error: `그림은 한 번에 ${CHAT_IMAGES_PER_MESSAGE}장까지 보낼 수 있습니다.` }, { status: 400 });
  if (files.length > CHAT_FILES_PER_MESSAGE) return NextResponse.json({ error: `파일은 한 번에 ${CHAT_FILES_PER_MESSAGE}개까지 보낼 수 있습니다.` }, { status: 400 });
  if (!images.every((im) => im && typeof im.type === "string" && CHAT_IMAGE_TYPE_RE.test(im.type) && typeof im.data === "string" && B64_RE.test(im.data))) return NextResponse.json({ error: "그림 형식이 올바르지 않습니다(PNG·JPEG·GIF·WebP)." }, { status: 400 });
  if (images.reduce((n, im) => n + base64Bytes(im.data), 0) > CHAT_IMAGES_MAX_BYTES) return NextResponse.json({ error: `그림은 합계 ${CHAT_IMAGES_MAX_BYTES / 1024 / 1024}MB까지 본문에 넣을 수 있습니다. 큰 그림은 파일로 보내 주세요.` }, { status: 400 });
  if (!files.every((f): f is string => typeof f === "string" && DRIVE_ITEM_ID_RE.test(f))) return NextResponse.json({ error: "첨부 파일이 올바르지 않습니다." }, { status: 400 });
  if (!text && !images.length && !files.length) return NextResponse.json({ error: "보낼 내용이 없습니다." }, { status: 400 });
  const p = await prepare();
  if (!p.ok) return p.response;
  try {
    let message, shareFailed = false;
    if (!images.length && !files.length) message = await sendChatMessage(p.token, chatId, text);
    else {
      const prepared = files.length ? await prepareChatFiles(p.token, chatId, (await fetchMe(p.token)).id, files) : { refs: [], shareFailed: false };
      shareFailed = prepared.shareFailed;
      message = await sendChatAttachments(p.token, chatId, text, images, prepared.refs);
    }
    await logAudit(p.admin, request, { userId: p.userId, action: "Teams 채팅 전송", category: "teams", detail: { chars: text.length, ...(images.length ? { images: images.length } : {}), ...(files.length ? { files: files.length } : {}) } });
    return NextResponse.json(shareFailed ? { message, warning: "받는 사람에게 파일 보기 권한을 주지 못했습니다. 열 때 접근을 요청해야 할 수 있습니다." } : { message });
  } catch (e) {
    if (e instanceof ChatFileError) return NextResponse.json({ error: e.message }, { status: 400 });
    return graphErrorResponse(e);
  }
}
