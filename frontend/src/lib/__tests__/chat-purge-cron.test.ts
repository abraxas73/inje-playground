// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ log: [] as string[], removed: [] as string[][], fail: false }));
function q(table: string) {
  const c: Record<string, unknown> = {};
  for (const k of ["select", "lt", "is", "in", "limit"]) c[k] = (...a: unknown[]) => { m.log.push(`${table}.${k}:${JSON.stringify(a)}`); return c; };
  c.delete = () => { m.log.push(`${table}.delete`); return c; };
  c.then = (res: (v: unknown) => void) => res({ data: table === "chat_conversations" ? [{ id: "c1" }] : [{ id: "a1", storage_path: "u/a1/original.png" }], error: null });
  return c;
}
vi.mock("@/lib/supabase-admin", () => ({ createAdminClient: () => ({ from: q, storage: { from: () => ({ remove: async (p: string[]) => { m.removed.push(p); return { error: m.fail ? { message: "x" } : null }; } }) } }) }));
import { GET } from "@/app/api/cron/chat-purge/route";
beforeEach(() => { m.log = []; m.removed = []; m.fail = false; vi.stubEnv("CRON_SECRET", "s3"); });

it("비밀값이 틀리면 401", async () => {
  expect((await GET(new NextRequest("https://a.test/api/cron/chat-purge", { headers: { authorization: "Bearer x" } }))).status).toBe(401);
});
it("만료 대화를 지우고, 하루 지난 고아 첨부의 객체와 행을 지운다", async () => {
  const j = await (await GET(new NextRequest("https://a.test/api/cron/chat-purge", { headers: { authorization: "Bearer s3" } }))).json();
  expect(j).toEqual({ conversations: 1, attachments: 1 });
  expect(m.log).toContain("chat_conversations.delete");
  expect(m.removed[0]).toEqual(["u/a1/original.png", "u/a1/text.txt"]);
  expect(m.log.some((l) => l.startsWith('chat_attachments.is:["conversation_id",null]'))).toBe(true);
});
it("버킷 삭제가 실패하면 첨부 행을 남긴다", async () => {
  m.fail = true;
  const j = await (await GET(new NextRequest("https://a.test/api/cron/chat-purge", { headers: { authorization: "Bearer s3" } }))).json();
  expect(j.attachments).toBe(0);
  expect(m.log).not.toContain("chat_attachments.delete");
});
