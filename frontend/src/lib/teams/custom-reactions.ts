import type { SupabaseClient } from "@supabase/supabase-js";
import { CUSTOM_REACTION_RE, HOSTED_CONTENT_ID_RE, MESSAGE_ID_RE, fetchHostedImage, type ChatMessage } from "@/lib/teams/chat";

/** 조직 사용자 정의 반응 등록부(teams_custom_reactions) — 메시지에서 처음 본 반응을 그림과 함께 저장해 고르기 창이 어느 방에서나 쓴다. */
const TABLE = "teams_custom_reactions";
const IMAGE_MAX = 1024 * 1024;
export const CUSTOM_REACTION_NAME_RE = /^[^;\s/?#\\:]{1,64}$/u;
export const customReactionImagePath = (name: string) => `/api/teams/chat/custom-reactions?${new URLSearchParams({ name })}`;

export interface RegisteredReaction { type: string; emoji: string; image: string }

// ponytail: 인스턴스 메모리 — 이미 등록한 이름은 DB를 다시 보지 않는다. 인스턴스가 바뀌면 한 번 다시 읽는다
let known: Set<string> | null = null;

/** 메시지들의 사용자 정의 반응 중 등록부에 없는 것을 본인 토큰으로 그림을 받아 넣는다(실패는 조용히 — 이 인스턴스에서는 다시 받지 않는다). */
export async function registerCustomReactions(admin: SupabaseClient, token: string, chatId: string, messages: ChatMessage[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const found = new Map<string, { id: string; message: string; content: string }>();
  for (const m of messages) for (const r of m.reactions) {
    const name = r.emoji.slice(1, -1);
    if (!CUSTOM_REACTION_RE.test(r.type) || !CUSTOM_REACTION_NAME_RE.test(name) || !r.image || found.has(name)) continue;
    const q = new URLSearchParams(r.image.split("?")[1] ?? "");
    const message = q.get("message") ?? "", content = q.get("content") ?? "";
    if (q.get("chat") === chatId && MESSAGE_ID_RE.test(message) && HOSTED_CONTENT_ID_RE.test(content)) found.set(name, { id: r.type, message, content });
  }
  if (!found.size) return 0;
  if (!known) {
    const { data, error } = await admin.from(TABLE).select("name");
    if (error) return 0;
    known = new Set((data ?? []).map((d) => d.name as string));
  }
  let added = 0;
  for (const [name, f] of found) {
    if (known.has(name)) continue;
    try {
      const img = await fetchHostedImage(token, chatId, f.message, f.content, fetchImpl);
      if ("error" in img || img.body.byteLength > IMAGE_MAX) { known.add(name); continue; } // 그림이 아니거나 너무 크면 등록하지 않는다
      const { error } = await admin.from(TABLE).upsert({ name, reaction_id: f.id, content_type: img.type, image: Buffer.from(img.body).toString("base64") }, { onConflict: "name", ignoreDuplicates: true });
      if (!error) { known.add(name); added++; }
    } catch { known.add(name); } // 권한·네트워크 실패 — 5초 폴링마다 다시 받지 않게, 다른 인스턴스·다른 사람이 볼 때 다시
  }
  return added;
}

/** 등록된 반응 목록(처음 본 순) — 고르기 창용 */
export async function listCustomReactions(admin: SupabaseClient): Promise<RegisteredReaction[]> {
  const { data, error } = await admin.from(TABLE).select("name, reaction_id").order("created_at");
  if (error) throw new Error(error.message);
  return (data ?? []).map((d) => ({ type: d.reaction_id as string, emoji: `:${d.name}:`, image: customReactionImagePath(d.name as string) }));
}

export async function customReactionImage(admin: SupabaseClient, name: string): Promise<{ body: Buffer; type: string } | null> {
  const { data } = await admin.from(TABLE).select("content_type, image").eq("name", name).maybeSingle();
  return data ? { body: Buffer.from(data.image as string, "base64"), type: data.content_type as string } : null;
}

/** 테스트용 */
export function resetCustomReactionCache() { known = null; }
