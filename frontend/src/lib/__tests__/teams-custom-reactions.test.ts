// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage } from "@/lib/teams/chat";
import { customReactionImage, listCustomReactions, registerCustomReactions, resetCustomReactionCache } from "@/lib/teams/custom-reactions";

const CHAT = "19:abc@thread.v2";
const img = (content: string, chat = CHAT) => `/api/teams/chat/image?${new URLSearchParams({ chat, message: "1700000000000", content })}`;
const msg = (reactions: ChatMessage["reactions"]): ChatMessage => ({ id: "1700000000000", createdAt: "", modifiedAt: "", from: null, text: "", markdown: "", attachments: [], reactions });

/** teams_custom_reactions 흉내 — select·upsert·order·eq·maybeSingle만 */
function fakeAdmin(rows: Array<Record<string, string>>) {
  const upserts: unknown[] = [];
  const admin = {
    from: () => ({
      select: () => {
        const q = { data: rows, error: null, order: async () => ({ data: rows, error: null }), eq: (_k: string, v: string) => ({ maybeSingle: async () => ({ data: rows.find((r) => r.name === v) ?? null }) }) };
        return Object.assign(Promise.resolve({ data: rows, error: null }), q);
      },
      upsert: async (row: Record<string, string>) => { upserts.push(row); rows.push({ ...row }); return { error: null }; },
    }),
  } as unknown as SupabaseClient;
  return { admin, upserts };
}

beforeEach(() => resetCustomReactionCache());

it("처음 본 사용자 정의 반응만 그림과 함께 등록(이미 있는 이름·ID 없는 것·다른 방 주소·그림 아님은 건너뜀), 두 번째부턴 DB를 다시 보지 않음", async () => {
  const { admin, upserts } = fakeAdmin([{ name: "nepp", reaction_id: "nepp;0-skr-d1-aa", content_type: "image/png", image: "" }]);
  const fetchImpl = vi.fn(async (url: string) => url.includes("bad")
    ? new Response("x", { headers: { "content-type": "text/html" } })
    : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/gif" } }));
  const messages = [msg([
    { type: "nepp;0-skr-d1-aa", emoji: ":nepp:", image: img("bmVw"), users: [] },
    { type: "daebak;0-skr-d3-21", emoji: ":daebak:", image: img("ZGI"), users: [] },
    { type: "custom", emoji: ":thankyou:", image: img("dGg"), users: [] },
    { type: "snp;0-skr-d2-1", emoji: ":snp:", image: img("c25", "19:other@thread.v2"), users: [] },
    { type: "bad;0-skr-d2-2", emoji: ":bad:", image: img("bad"), users: [] },
    { type: "👍", emoji: "👍", users: [] },
  ])];
  expect(await registerCustomReactions(admin, "AT", CHAT, messages, fetchImpl as unknown as typeof fetch)).toBe(1);
  expect(upserts).toEqual([{ name: "daebak", reaction_id: "daebak;0-skr-d3-21", content_type: "image/gif", image: "AQID" }]);
  expect(fetchImpl).toHaveBeenCalledTimes(2); // daebak·bad만
  expect(await registerCustomReactions(admin, "AT", CHAT, messages, fetchImpl as unknown as typeof fetch)).toBe(0);
  expect(fetchImpl).toHaveBeenCalledTimes(2); // 그림 아님(bad)도 다시 받지 않는다
  expect(await listCustomReactions(admin)).toEqual([
    { type: "nepp;0-skr-d1-aa", emoji: ":nepp:", image: "/api/teams/chat/custom-reactions?name=nepp" },
    { type: "daebak;0-skr-d3-21", emoji: ":daebak:", image: "/api/teams/chat/custom-reactions?name=daebak" },
  ]);
  expect(await customReactionImage(admin, "daebak")).toEqual({ body: Buffer.from([1, 2, 3]), type: "image/gif" });
  expect(await customReactionImage(admin, "none")).toBeNull();
});
