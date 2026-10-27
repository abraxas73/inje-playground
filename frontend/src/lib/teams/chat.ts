/**
 * Teams 채팅(내가 속한 그룹·1:1) — Microsoft Graph 위임 호출(Chat.ReadWrite). 서버 전용.
 * 메시지 본문(HTML)은 텍스트로 정리해 돌려주고, 채팅 내용은 저장·로그하지 않는다.
 */
import type { FetchLike } from "@/lib/notify/types";
import { GRAPH_BASE } from "@/lib/teams-graph";
import { GraphError, fetchWithRetry } from "@/lib/ms/graph-drive";
import { byNewest } from "@/lib/teams/sort";

export const CHAT_MESSAGE_MAX = 4000;
/** Teams 채팅 ID(`19:…@thread.v2`, 1:1은 `19:…@unq.gbl.spaces`). 경로 조각으로 쓰므로 허용 문자만. */
export const CHAT_ID_RE = /^[0-9A-Za-z:_@.\-]{3,200}$/;

/** 첨부 — 파일(`reference`)은 contentUrl(SharePoint·OneDrive, 본인 권한으로 열림), 카드류는 url 없음 */
export interface ChatAttachment { id: string; name: string; url: string | null }
export interface ChatMessage {
  id: string;
  createdAt: string;
  modifiedAt: string;
  from: { id: string; name: string } | null;
  text: string;
  /** 화면 표시용 마크다운(문단·굵게·목록·링크·멘션 — teamsHtmlToMarkdown). text는 이노봇·브리핑·검색용 평문 */
  markdown: string;
  attachments: ChatAttachment[];
  /** 반응(종류별로 묶음). type은 Graph 원래 값(떼기에 그대로 쓴다), emoji는 표시용 */
  reactions: ChatReaction[];
}

export interface ChatReaction { type: string; emoji: string; users: Array<{ id: string; name: string }> }
/** 우리 화면에서 고르는 반응 — Teams 기본 6개 + 자주 쓰는 6개(조직 사용자 정의 스티커는 Graph가 붙이기를 받지 않아 뺀다) */
export const REACTION_CHOICES = ["👍", "❤️", "😆", "😮", "😢", "😡", "👀", "👏", "🙌", "🔥", "🎉", "🙏"] as const;
/** 옛 이름 반응 → 그림 문자(Graph는 like 등 옛 값과 유니코드를 섞어 준다) */
const LEGACY_REACTION: Record<string, string> = { like: "👍", heart: "❤️", laugh: "😆", surprised: "😮", sad: "😢", angry: "😡" };
export const REACTION_MAX = 16;

/** 메시지의 reactions → 종류별 묶음(처음 붙은 순). custom(조직 사용자 정의)은 그림이 URL이라 이름으로 대신, 이름별로 따로 묶고 우리 화면에서는 붙이거나 떼지 않는다(Graph가 "custom" 값을 받지 않음) */
export function normalizeReactions(list: unknown): ChatReaction[] {
  if (!Array.isArray(list)) return [];
  const byType = new Map<string, ChatReaction>();
  for (const r of list as Array<Record<string, unknown>>) {
    if (!r || typeof r.reactionType !== "string" || !r.reactionType) continue;
    const type = r.reactionType;
    const emoji = LEGACY_REACTION[type.toLowerCase()] ?? (type === "custom" ? `:${typeof r.displayName === "string" && r.displayName ? r.displayName : "반응"}:` : type);
    const u = ((r.user as { user?: { id?: unknown; displayName?: unknown } } | undefined)?.user) ?? {};
    const key = type === "custom" ? `custom|${emoji}` : type;
    const g = byType.get(key) ?? { type, emoji, users: [] };
    g.users.push({ id: String(u.id ?? ""), name: String(u.displayName ?? "") });
    byType.set(key, g);
  }
  return [...byType.values()];
}

export type ChatType = "group" | "oneOnOne";
export interface ChatSummary {
  id: string;
  type: ChatType;
  /** 주제가 없으면 나를 뺀 구성원 이름 */
  topic: string;
  members: string[];
  webUrl: string | null;
  /** 마지막 메시지 시각(lastMessagePreview). 메시지가 없으면 이름·구성원 변경 시각(lastUpdatedDateTime) */
  lastUpdated: string | null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1]?.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Teams 메시지 HTML → 읽기 좋은 텍스트. 멘션은 @이름, 링크는 "글 (주소)", 이미지는 [이미지], 첨부 자리표시자는 제거, 빈 줄은 버린다. */
export function teamsHtmlToText(html: string): string {
  let s = html;
  s = s.replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, "").replace(/<attachment\b[^>]*\/?>/gi, "");
  s = s.replace(/<img\b[^>]*>/gi, "[이미지]");
  s = s.replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi, "@$1");
  s = s.replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, text: string) => {
    const t = decodeEntities(text.replace(/<[^>]+>/g, "")).trim();
    const h = decodeEntities(href);
    return !t || t === h ? h : `${t} (${h})`;
  });
  s = s.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre)>/gi, "\n");
  s = decodeEntities(s.replace(/<[^>]+>/g, ""));
  return s.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l !== "").join("\n");
}

const MD_ESCAPE = /[\\`*_[\]<>~|#&]/g;
const LINE_START_ESCAPE = /^(\d+)([.)])|^([-+=])/;
const attr = (tag: string, name: string) => decodeEntities(new RegExp(`\\b${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? "");

/**
 * Teams 메시지 HTML → 마크다운(화면 표시 전용 — text는 이노봇·브리핑용 평문 그대로).
 * 살리는 것: 줄(</p>·<br> = 줄바꿈, 빈 <p> = 빈 줄), 굵게·기울임·취소선·코드, 번호·글머리 목록(중첩·start), 링크(http·mailto만), 멘션(굵은 @이름), 그림 문자.
 * 글자색·크기는 마크다운에 없어 버린다. 원문 HTML은 그리지 않는다 — 글은 모두 이스케이프해 마크다운 문법으로만 해석된다.
 */
export function teamsHtmlToMarkdown(html: string): string {
  const src = html.replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, "").replace(/<attachment\b[^>]*\/?>/gi, "");
  let out = "";
  let brk = 0; // 다음 글 앞에 넣을 끊김: 1 줄바꿈, 2 빈 줄
  let lineStart = true;
  let blockHasText = false;
  let b = 0, i = 0, s = 0, code = 0, pre = 0;
  let preText = "";
  const spans: boolean[] = []; // <span style="font-weight:bold"> 여부
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let mention: string | null = null;
  let link: { href: string; text: string } | null = null;
  let run = { text: "", key: "" };

  const write = (t: string) => {
    if (!t) return;
    if (out && brk && !lineStart) {
      out = out.replace(/[ \t]+$/, "") + (brk === 2 ? "\n\n" : `  \n${"    ".repeat(lists.length)}`);
      lineStart = true;
    }
    brk = 0;
    out += t;
    lineStart = false;
    blockHasText = true;
  };
  const escape = (t: string, atStart: boolean) => {
    const e = t.replace(MD_ESCAPE, "\\$&");
    return atStart ? e.replace(LINE_START_ESCAPE, (_m, d?: string, p?: string, c?: string) => (d ? `${d}\\${p}` : `\\${c}`)) : e;
  };
  const flush = () => {
    const { text, key } = run;
    run = { text: "", key: "" };
    if (!text.trim()) {
      if (text && !lineStart && !brk) out += " ";
      return;
    }
    const lead = /^\s/.test(text) && !lineStart && !brk && !out.endsWith(" ") ? " " : "";
    const core = text.trim();
    const atStart = lineStart || brk > 0 || !out;
    let body: string;
    if (key.includes("c")) body = core.includes("`") ? `\`\` ${core} \`\`` : `\`${core}\``;
    else {
      body = escape(core, atStart && !lead);
      const mark = (key.includes("b") ? "**" : "") + (key.includes("i") ? "*" : "");
      body = key.includes("s") ? `~~${body}~~` : body;
      // 구두점으로 시작·끝나면 한글과 붙은 **가 닫히지 않는다(CommonMark flanking) — 마커 바깥에 머리카락 공백(U+200A)
      const hair = (mark || key.includes("s")) && /^\p{P}/u.test(core) && !atStart && !lead && !/\s$/.test(out) ? "\u200A" : "";
      body = mark ? `${mark}${body}${[...mark].reverse().join("")}` : body;
      body = hair + body + ((mark || key.includes("s")) && /\p{P}$/u.test(core) ? "\u200A" : "");
    }
    if (lead) out += lead;
    write(body);
    if (/\s$/.test(text)) out += " ";
  };
  const text = (t: string, key = `${b || spans.includes(true) ? "b" : ""}${i ? "i" : ""}${s ? "s" : ""}${code ? "c" : ""}`) => {
    if (key !== run.key) flush();
    run.key = key;
    run.text += t;
  };
  const lineBreak = (level: 1 | 2) => {
    flush();
    if (out) brk = Math.max(brk, level);
  };
  const newLine = () => {
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n")) out += "\n";
    brk = 0;
    lineStart = true;
  };

  for (const [tok] of src.matchAll(/<[^>]*>|[^<]+/g)) {
    if (tok[0] !== "<") {
      const t = decodeEntities(tok);
      if (link) link.text += t;
      else if (mention !== null) mention += t;
      else if (pre) preText += t;
      else text(t.replace(/\s+/g, " "));
      continue;
    }
    const m = /^<\s*(\/)?\s*([a-z0-9]+)/i.exec(tok);
    if (!m) continue;
    const close = !!m[1];
    const name = m[2].toLowerCase();
    switch (name) {
      case "br": if (pre) preText += "\n"; else { flush(); lineBreak(brk >= 1 ? 2 : 1); } break;
      case "p": case "div": case "h1": case "h2": case "h3": case "h4": case "h5": case "h6": case "blockquote": case "tr":
        if (pre) break;
        if (!close) { lineBreak(1); blockHasText = false; }
        else { flush(); if (out) brk = Math.max(brk, blockHasText || lists.length ? 1 : 2); blockHasText = false; }
        break;
      case "td": case "th": if (close) text(" "); break;
      case "strong": case "b": b += close ? -1 : 1; b = Math.max(0, b); break;
      case "em": case "i": i = Math.max(0, i + (close ? -1 : 1)); break;
      case "s": case "strike": case "del": s = Math.max(0, s + (close ? -1 : 1)); break;
      case "code": if (!pre) code = Math.max(0, code + (close ? -1 : 1)); break;
      case "span":
        if (close) spans.pop();
        else spans.push(/font-weight\s*:\s*(bold|[6-9]00)/i.test(attr(tok, "style")));
        break;
      case "pre": case "codeblock":
        flush();
        if (!close && !pre) { if (out) { newLine(); out += "\n"; } preText = ""; }
        pre = Math.max(0, pre + (close ? -1 : 1));
        if (close && !pre) {
          // 내용의 ``` 줄이 펜스를 일찍 닫지 않게 가장 긴 백틱보다 하나 더
          const fence = "`".repeat(Math.max(3, ...[...preText.matchAll(/`+/g)].map(([f]) => f.length + 1)));
          out += `${fence}\n${preText.replace(/^\n+|\n+$/g, "")}\n${fence}`;
          brk = 2;
          lineStart = false;
        }
        break;
      case "ol": case "ul":
        flush();
        if (!close) {
          if (!lists.length && out) { newLine(); out += "\n"; }
          const start = parseInt(attr(tok, "start"), 10);
          lists.push({ ordered: name === "ol", n: Number.isFinite(start) && start > 0 ? start : 1 });
        } else if (lists.pop() && !lists.length) brk = 2;
        break;
      case "li": {
        flush();
        if (close) break;
        const l = lists[lists.length - 1] ?? { ordered: false, n: 1 };
        newLine();
        out += `${"    ".repeat(Math.max(0, lists.length - 1))}${l.ordered ? `${l.n++}. ` : "- "}`;
        lineStart = true;
        break;
      }
      case "at":
        if (!close) { flush(); mention = ""; break; }
        if (mention !== null) {
          const n = mention.replace(/\s+/g, " ").trim();
          mention = null;
          if (n) { if (!lineStart && !brk && out && !out.endsWith(" ")) out += " "; text(`@${n}`, "b"); flush(); out += " "; }
        }
        break;
      case "a":
        if (!close) { flush(); link = { href: attr(tok, "href"), text: "" }; break; }
        if (link) {
          const { href, text: t } = link;
          link = null;
          const label = t.replace(/\s+/g, " ").trim() || href;
          if (/^(https?:|mailto:)/i.test(href)) { flush(); if (!lineStart && !brk && out && !out.endsWith(" ")) out += " "; write(`[${escape(label, false)}](${href.replace(/[\s()<>]/g, encodeURIComponent)})`); }
          else text(label);
        }
        break;
      case "img": case "emoji": {
        if (close) break;
        const alt = attr(tok, "alt");
        const hosted = name === "img" ? hostedImagePath(attr(tok, "src")) : null;
        if (name === "emoji" || /emoji/i.test(attr(tok, "itemtype"))) { if (alt) text(alt); }
        else if (hosted) { flush(); if (!lineStart && !brk && out && !out.endsWith(" ")) out += " "; write(`![이미지](${hosted})`); }
        else text("[이미지]");
        break;
      }
    }
  }
  flush();
  return out.trim();
}

/** Teams 본문 그림 ID(hostedContents) — base64 계열 */
export const HOSTED_CONTENT_ID_RE = /^[A-Za-z0-9+/=_-]{1,4096}$/;

/**
 * 본문 그림 src(Graph hostedContents, 로그인 토큰이 있어야 열림) → 우리 중계 주소 `/api/teams/chat/image?…`.
 * 다른 주소(외부 그림·스티커)는 null — 불러오지 않고 [이미지]로 둔다.
 */
export function hostedImagePath(src: string): string | null {
  const m = /^https:\/\/graph\.microsoft\.com\/(?:v1\.0|beta)\/chats\/([^/?#]+)\/messages\/([^/?#]+)\/hostedContents\/(.+?)\/\$value$/i.exec(src.trim());
  if (!m) return null;
  let chat: string, message: string, content: string;
  try {
    [chat, message, content] = [decodeURIComponent(m[1]), decodeURIComponent(m[2]), decodeURIComponent(m[3])];
  } catch {
    return null;
  }
  if (!CHAT_ID_RE.test(chat) || !MESSAGE_ID_RE.test(message) || !HOSTED_CONTENT_ID_RE.test(content)) return null;
  return `/api/teams/chat/image?${new URLSearchParams({ chat, message, content }).toString()}`;
}

/** 본문 그림 상한 — Vercel 함수 응답 한계(약 4.5MB) 안 */
export const HOSTED_IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/**
 * 본문 그림 원본(바이트) — 본인 위임 토큰으로. 그림 형식만(아니면 "type"), 상한을 넘으면 본문을 다 읽지 않고 "size".
 */
export async function fetchHostedImage(token: string, chatId: string, messageId: string, contentId: string, fetchImpl: FetchLike = fetch): Promise<{ body: Uint8Array<ArrayBuffer>; type: string } | { error: "type" | "size" }> {
  const url = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/hostedContents/${encodeURIComponent(contentId)}/$value`;
  const res = await fetchWithRetry(fetchImpl, url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new GraphError(res.status, `http_${res.status}`, (await res.text()).slice(0, 300), res.headers.get("request-id"));
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (!/^image\/(png|jpe?g|gif|webp|bmp)$/.test(type) || declared > HOSTED_IMAGE_MAX_BYTES) {
    await res.body?.cancel();
    return { error: declared > HOSTED_IMAGE_MAX_BYTES ? "size" : "type" };
  }
  // 길이 머리글이 없거나 틀려도 상한에서 끊는다
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body?.getReader();
  for (;;) {
    const r = reader ? await reader.read() : { done: true as const, value: undefined };
    if (r.done) break;
    total += r.value.byteLength;
    if (total > HOSTED_IMAGE_MAX_BYTES) { await reader?.cancel(); return { error: "size" }; }
    chunks.push(r.value);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { body.set(c, at); at += c.byteLength; }
  return { body, type };
}

/** 답글 인용(messageReference)은 본문이 이미 대화에 있으니 첨부로 세지 않는다. contentUrl은 http(s)만(파일 첨부는 data: 가능). */
function normalizeAttachments(list: unknown): ChatAttachment[] {
  if (!Array.isArray(list)) return [];
  return (list as Array<Record<string, unknown>>)
    .filter((a) => a && typeof a === "object" && a.contentType !== "messageReference")
    .map((a) => ({
      id: String(a.id ?? ""),
      name: typeof a.name === "string" && a.name ? a.name : "첨부",
      url: typeof a.contentUrl === "string" && /^https?:\/\//i.test(a.contentUrl) ? a.contentUrl : null,
    }));
}

export function normalizeChatMessage(r: unknown): ChatMessage | null {
  if (!r || typeof r !== "object") return null;
  const o = r as Record<string, unknown>;
  if (o.messageType !== "message" || o.deletedDateTime) return null;
  const from = o.from as Record<string, Record<string, unknown> | undefined> | null | undefined;
  const who = from?.user ?? from?.application ?? null;
  const body = o.body as { contentType?: string; content?: string } | undefined;
  const content = body?.content ?? "";
  return {
    id: String(o.id ?? ""),
    createdAt: String(o.createdDateTime ?? ""),
    modifiedAt: String(o.lastModifiedDateTime ?? o.createdDateTime ?? ""),
    from: who ? { id: String(who.id ?? ""), name: String(who.displayName ?? "") } : null,
    text: body?.contentType === "html" ? teamsHtmlToText(content) : content.trim(),
    markdown: body?.contentType === "html" ? teamsHtmlToMarkdown(content) : content.trim().replace(MD_ESCAPE, "\\$&").replace(/\n/g, "  \n"),
    attachments: normalizeAttachments(o.attachments),
    reactions: normalizeReactions(o.reactions),
  };
}

/** 목록 응답 → message 종류만(시스템 이벤트·삭제 제외), 오래된 것부터 */
export function normalizeChatMessages(json: unknown): ChatMessage[] {
  const value = (json as { value?: unknown } | null)?.value;
  const list = Array.isArray(value) ? value : [];
  return list.map(normalizeChatMessage).filter((m): m is ChatMessage => m !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function chatMessagesUrl(chatId: string, since?: string): string {
  const base = `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages?$top=50`;
  return since ? `${base}&$filter=${encodeURIComponent(`lastModifiedDateTime gt ${since}`)}` : base;
}

async function graph(token: string, url: string, init: RequestInit, fetchImpl: FetchLike): Promise<unknown> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) };
  const res = await fetchWithRetry(fetchImpl, url, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    let code = `http_${res.status}`;
    let message = text.slice(0, 300);
    try {
      const j = JSON.parse(text) as { error?: { code?: string; message?: string } };
      code = j.error?.code ?? code;
      message = j.error?.message ?? message;
    } catch {
      // JSON이 아닌 오류 본문
    }
    throw new GraphError(res.status, code, message, res.headers.get("request-id"));
  }
  return res.status === 204 ? null : res.json();
}

export async function listChatMessages(token: string, chatId: string, since?: string, fetchImpl: FetchLike = fetch): Promise<ChatMessage[]> {
  return normalizeChatMessages(await graph(token, chatMessagesUrl(chatId, since), {}, fetchImpl));
}

export async function sendChatMessage(token: string, chatId: string, text: string, fetchImpl: FetchLike = fetch): Promise<ChatMessage> {
  const j = await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages`, { method: "POST", body: JSON.stringify({ body: { contentType: "text", content: text } }) }, fetchImpl);
  const now = new Date().toISOString();
  return normalizeChatMessage(j) ?? { id: String((j as { id?: unknown } | null)?.id ?? ""), createdAt: now, modifiedAt: now, from: null, text, markdown: "", attachments: [], reactions: [] };
}

/**
 * 내가 속한 채팅(그룹·1:1, 모임 채팅 제외) — 마지막 메시지 순. 주제가 없으면 나(meId)를 뺀 구성원 이름을 주제로.
 * lastUpdatedDateTime은 이름·구성원 변경 시각이라 메시지가 와도 안 바뀐다 — lastMessagePreview.createdDateTime으로 정렬(Graph $orderby는 desc만 지원).
 */
export async function listMyChats(token: string, meId: string, fetchImpl: FetchLike = fetch): Promise<ChatSummary[]> {
  // $expand 안의 중첩 $select는 채팅 목록에서 400(BadRequest) — members 전체를 펼친다(displayName·userId 포함)
  const url = `${GRAPH_BASE}/me/chats?$expand=members,lastMessagePreview&$orderby=lastMessagePreview/createdDateTime%20desc&$top=50`;
  let j: { value?: Array<Record<string, unknown>> } | null;
  try {
    j = (await graph(token, url, {}, fetchImpl)) as typeof j;
  } catch (e) {
    // ponytail: 조합 쿼리를 Graph가 400으로 거절하면 옛 쿼리(이름·구성원 변경 시각 정렬)로 한 번 재시도 — 운영에서 조합이 확인되면 제거
    if (!(e instanceof GraphError && e.status === 400)) throw e;
    console.warn("[teams-chat] 채팅 목록 $expand·$orderby 조합 거절(400) — members만 펼쳐 재시도:", e.message);
    j = (await graph(token, `${GRAPH_BASE}/me/chats?$expand=members&$top=50`, {}, fetchImpl)) as typeof j;
  }
  return (j?.value ?? [])
    .filter((c) => c.chatType === "group" || c.chatType === "oneOnOne")
    .map((c) => {
      const raw = (Array.isArray(c.members) ? c.members : []) as Array<{ displayName?: unknown; userId?: unknown }>;
      const members = raw.map((m) => String(m.displayName ?? "")).filter(Boolean);
      const others = raw.filter((m) => String(m.userId ?? "") !== meId).map((m) => String(m.displayName ?? "")).filter(Boolean);
      return {
        id: String(c.id ?? ""),
        type: c.chatType as ChatType,
        topic: typeof c.topic === "string" && c.topic ? c.topic : others.join(", ") || members.join(", ") || "(이름 없음)",
        members,
        webUrl: typeof c.webUrl === "string" ? c.webUrl : null,
        lastUpdated: [(c.lastMessagePreview as { createdDateTime?: unknown } | null)?.createdDateTime, c.lastUpdatedDateTime].find((v): v is string => typeof v === "string") ?? null,
      };
    })
    .sort(byNewest);
}


export async function getChatInfo(token: string, chatId: string, fetchImpl: FetchLike = fetch): Promise<{ id: string; topic: string | null; webUrl: string | null }> {
  const j = (await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}?$select=id,topic,webUrl,chatType`, {}, fetchImpl)) as Record<string, unknown>;
  return { id: String(j.id ?? chatId), topic: typeof j.topic === "string" && j.topic ? j.topic : null, webUrl: typeof j.webUrl === "string" ? j.webUrl : null };
}

/** 메시지 검색 결과 한 건 — 본문 대신 Microsoft Search 요약(검색어 주변)만 */
export interface ChatSearchHit { id: string; chatId: string; createdAt: string; from: string; snippet: string }
export const CHAT_SEARCH_MIN = 2;
export const CHAT_SEARCH_MAX = 100;

/** 검색 응답 → 그룹·1:1 채팅 메시지만(채널 메시지는 chatId가 없어 뺀다). 요약의 강조 태그(<c0>)·엔티티는 글자로 */
export function normalizeSearchHits(json: unknown): ChatSearchHit[] {
  const containers = ((json as { value?: Array<{ hitsContainers?: unknown[] }> } | null)?.value ?? []).flatMap((v) => (Array.isArray(v.hitsContainers) ? v.hitsContainers : []));
  const hits = containers.flatMap((c) => { const h = (c as { hits?: unknown }).hits; return Array.isArray(h) ? h : []; }) as Array<{ summary?: unknown; resource?: Record<string, unknown> }>;
  const out: ChatSearchHit[] = [];
  for (const h of hits) {
    const r = h.resource ?? {};
    const chatId = typeof r.chatId === "string" ? r.chatId : "";
    if (!CHAT_ID_RE.test(chatId)) continue;
    const from = (r.from as { emailAddress?: { name?: unknown }; user?: { displayName?: unknown } } | undefined);
    out.push({
      id: String(r.id ?? ""),
      chatId,
      createdAt: String(r.createdDateTime ?? ""),
      from: String(from?.emailAddress?.name ?? from?.user?.displayName ?? ""),
      snippet: teamsHtmlToText(typeof h.summary === "string" ? h.summary : "").replace(/\s+/g, " ").trim(),
    });
  }
  return out;
}

/** 내 Teams 메시지 검색(Microsoft Search, Chat.ReadWrite로 충분) — 관련도 순 최대 25건. 결과 정렬은 API가 지원하지 않는다. */
export async function searchChatMessages(token: string, query: string, fetchImpl: FetchLike = fetch): Promise<ChatSearchHit[]> {
  const body = { requests: [{ entityTypes: ["chatMessage"], query: { queryString: query }, from: 0, size: 25 }] };
  return normalizeSearchHits(await graph(token, `${GRAPH_BASE}/search/query`, { method: "POST", body: JSON.stringify(body) }, fetchImpl));
}

export const MESSAGE_ID_RE = /^[0-9A-Za-z_-]{1,64}$/;

/** 반응 붙이기·떼기(본인 이름, Chat.ReadWrite). 성공하면 204. 떼기는 붙어 있던 Graph 값 그대로(옛 like 등도) */
export async function setChatReaction(token: string, chatId: string, messageId: string, reactionType: string, on: boolean, fetchImpl: FetchLike = fetch): Promise<void> {
  const action = on ? "setReaction" : "unsetReaction";
  await graph(token, `${GRAPH_BASE}/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/${action}`, { method: "POST", body: JSON.stringify({ reactionType }) }, fetchImpl);
}
