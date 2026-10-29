/**
 * Teams 채팅 첨부 보내기 — 그림은 본문 그림(hostedContents, 메시지에 실림), 파일은 내 OneDrive "Microsoft Teams Chat Files"에 올린 뒤 참조 첨부(Teams 앱과 같은 자리).
 * 파일 바이트는 서버를 거치지 않는다: 서버가 업로드 세션 주소만 만들어 주고 화면이 그 주소에 직접 올린다(Vercel 요청 4.5MB 한계).
 * 받는 사람이 열 수 있게 채팅 구성원에게 읽기 권한을 준다(알림 메일 없이).
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";
import { GraphError } from "@/lib/ms/graph-drive";
import { graph, normalizeChatMessage, type ChatMessage } from "./chat";

export const CHAT_FILES_FOLDER = "Microsoft Teams Chat Files";
/** 파일 하나 상한 — 업로드 세션은 더 받지만 채팅 첨부로는 이 정도로 */
export const CHAT_FILE_MAX_BYTES = 250 * 1024 * 1024;
export const CHAT_FILES_PER_MESSAGE = 10;
/** 본문 그림 — 요청 본문(base64)이 Vercel 4.5MB 안에 들도록 합계 3MB, 4장 */
export const CHAT_IMAGES_MAX_BYTES = 3 * 1024 * 1024;
export const CHAT_IMAGES_PER_MESSAGE = 4;
export const CHAT_IMAGE_TYPE_RE = /^image\/(png|jpeg|gif|webp)$/;
export const DRIVE_ITEM_ID_RE = /^[0-9A-Za-z!._-]{1,200}$/;

/** 사용자에게 그대로 보여 줄 첨부 오류(400) */
export class ChatFileError extends Error {}

export interface ChatImage { type: string; data: string }
export interface ChatFileRef { id: string; name: string; url: string }

/** 파일 이름 — OneDrive가 받지 않는 글자는 _로, 앞뒤 공백·점 제거, 200자. 비면 "파일" */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 200);
  return s || "파일";
}

/** 업로드 세션 — 같은 이름이 있으면 OneDrive가 이름을 바꾼다. 돌려준 주소는 토큰 없이 PUT(조각)으로 올린다 */
export async function createChatUpload(token: string, name: string, fetchImpl: FetchLike = fetch): Promise<{ uploadUrl: string }> {
  const path = [CHAT_FILES_FOLDER, safeFileName(name)].map(encodeURIComponent).join("/");
  const j = (await graph(token, `${GRAPH_BASE}/me/drive/root:/${path}:/createUploadSession`, { method: "POST", body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }) }, fetchImpl)) as { uploadUrl?: unknown } | null;
  if (typeof j?.uploadUrl !== "string" || !j.uploadUrl.startsWith("https://")) throw new GraphError(502, "upload_url_missing", "no uploadUrl", null);
  return { uploadUrl: j.uploadUrl };
}

/**
 * 올린 내 파일 → 첨부 참조(eTag의 GUID가 첨부 id, webDavUrl이 주소 — Graph 문서 예시 4). 채팅 구성원(나 빼고)에게 읽기 권한을 준다.
 * 권한 주기가 막혀도(공유 정책 등) 메시지는 보내고 shareFailed로 알린다 — 받는 사람은 열 때 접근을 요청할 수 있다.
 * ponytail: 구성원 첫 쪽만(@odata.nextLink 무시) — 아주 큰 그룹 채팅이면 다음 쪽까지.
 */
export async function prepareChatFiles(token: string, chatId: string, meId: string, itemIds: string[], fetchImpl: FetchLike = fetch): Promise<{ refs: ChatFileRef[]; shareFailed: boolean }> {
  if (!itemIds.length) return { refs: [], shareFailed: false };
  const members = (await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/members`, {}, fetchImpl)) as { value?: Array<{ userId?: unknown; email?: unknown }> } | null;
  const recipients = (members?.value ?? []).filter((m) => m.userId !== meId && typeof m.email === "string" && m.email.includes("@")).map((m) => ({ email: m.email as string }));
  const out: ChatFileRef[] = [];
  let shareFailed = false;
  for (const id of itemIds) {
    const item = (await graph(token, `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(id)}?$select=id,name,eTag,webDavUrl`, {}, fetchImpl)) as { name?: unknown; eTag?: unknown; webDavUrl?: unknown } | null;
    const guid = /\{([0-9A-Fa-f-]{36})\}/.exec(String(item?.eTag ?? ""))?.[1];
    if (!guid || typeof item?.webDavUrl !== "string") throw new ChatFileError("첨부 파일을 확인하지 못했습니다. 다시 올려 주세요.");
    if (recipients.length) {
      try { await graph(token, `${GRAPH_BASE}/me/drive/items/${encodeURIComponent(id)}/invite`, { method: "POST", body: JSON.stringify({ recipients, roles: ["read"], requireSignIn: true, sendInvitation: false }) }, fetchImpl); }
      catch { shareFailed = true; }
    }
    out.push({ id: guid.toLowerCase(), name: String(item.name ?? "파일"), url: item.webDavUrl });
  }
  return { refs: out, shareFailed };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** 첨부가 있는 메시지 본문(HTML) — 글(줄바꿈 → br), 그림(../hostedContents/N/$value), 파일 자리(<attachment>) 순 */
export function attachmentMessageBody(text: string, images: ChatImage[], files: ChatFileRef[]) {
  const parts = [
    text ? `<p>${escapeHtml(text).replace(/\r?\n/g, "<br>")}</p>` : "",
    ...images.map((_, i) => `<p><img src="../hostedContents/${i + 1}/$value" alt="이미지"></p>`),
    ...files.map((f) => `<attachment id="${f.id}"></attachment>`),
  ];
  return {
    body: { contentType: "html", content: parts.join("") },
    ...(images.length ? { hostedContents: images.map((im, i) => ({ "@microsoft.graph.temporaryId": String(i + 1), contentBytes: im.data, contentType: im.type })) } : {}),
    ...(files.length ? { attachments: files.map((f) => ({ id: f.id, contentType: "reference", contentUrl: f.url, name: f.name })) } : {}),
  };
}

export async function sendChatAttachments(token: string, chatId: string, text: string, images: ChatImage[], files: ChatFileRef[], fetchImpl: FetchLike = fetch): Promise<ChatMessage> {
  const j = await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages`, { method: "POST", body: JSON.stringify(attachmentMessageBody(text, images, files)) }, fetchImpl);
  const now = new Date().toISOString();
  return normalizeChatMessage(j) ?? { id: String((j as { id?: unknown } | null)?.id ?? ""), createdAt: now, modifiedAt: now, from: null, text, markdown: "", attachments: files.map((f) => ({ id: f.id, name: f.name, url: f.url })), reactions: [] };
}

/** base64 디코드 길이(패딩 고려) — 본문 그림 합계 검사용 */
export const base64Bytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
