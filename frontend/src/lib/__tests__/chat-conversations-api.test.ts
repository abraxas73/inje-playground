// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ conv: null as null | Record<string, unknown>, calls: [] as string[], removed: [] as string[][], fail: false }));
function q(table: string) {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "in", "is", "order", "limit", "update"]) chain[k] = (...a: unknown[]) => { m.calls.push(`${table}.${k}:${JSON.stringify(a)}`); return chain; };
  chain.maybeSingle = async () => ({ data: table === "chat_conversations" ? m.conv : null, error: null });
  chain.delete = () => { m.calls.push(`${table}.delete`); return chain; };
  chain.then = (res: (v: unknown) => void) => res({ data: table === "chat_conversations" ? [{ id: "c1", title: "t", model: "s", last_message_at: "x" }] : table === "chat_attachments" ? [{ storage_path: "u1/a1/original.pdf" }] : [], error: null });
  return chain;
}
const admin = { from: q, storage: { from: () => ({ remove: async (p: string[]) => { m.removed.push(p); return { error: m.fail ? { message: "x" } : null }; } }) } };
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => ({ ok: true, userId: "u1", role: "user", admin }) }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
import { GET as LIST } from "@/app/api/chat/conversations/route";
import { DELETE, GET, PATCH } from "@/app/api/chat/conversations/[id]/route";
const ID = "00000000-0000-0000-0000-000000000001";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
beforeEach(() => { m.conv = { id: ID, user_id: "u1" }; m.calls = []; m.removed = []; m.fail = false; });

it("목록은 내 것·저장 안 함 제외", async () => {
  const j = await (await LIST(new NextRequest("https://a.test/api/chat/conversations"))).json();
  expect(j.conversations).toHaveLength(1);
  expect(m.calls).toEqual(expect.arrayContaining(['chat_conversations.eq:["user_id","u1"]', 'chat_conversations.eq:["ephemeral",false]']));
});
it("남의 대화·잘못된 id는 404", async () => {
  m.conv = null;
  expect((await GET(new NextRequest("https://a.test/x"), ctx())).status).toBe(404);
  expect((await GET(new NextRequest("https://a.test/x"), ctx("../etc"))).status).toBe(404);
  expect((await DELETE(new NextRequest("https://a.test/x", { method: "DELETE" }), ctx())).status).toBe(404);
});
it("이름 바꾸기는 1~80자", async () => {
  const p = (title: unknown) => PATCH(new NextRequest("https://a.test/x", { method: "PATCH", body: JSON.stringify({ title }) }), ctx());
  expect((await p("")).status).toBe(400);
  expect((await p("가".repeat(81))).status).toBe(400);
  expect((await p("새 이름")).status).toBe(200);
});
it("삭제는 첨부 원본·텍스트 객체를 지우고 대화를 지운다", async () => {
  expect((await DELETE(new NextRequest("https://a.test/x", { method: "DELETE" }), ctx())).status).toBe(200);
  expect(m.removed[0]).toEqual(["u1/a1/original.pdf", "u1/a1/text.txt"]);
  expect(m.calls).toContain("chat_conversations.delete");
});
it("버킷 삭제가 실패하면 첨부 행은 남기고 대화는 지운다", async () => {
  m.fail = true;
  expect((await DELETE(new NextRequest("https://a.test/x", { method: "DELETE" }), ctx())).status).toBe(200);
  expect(m.calls).not.toContain("chat_attachments.delete");
  expect(m.calls).toContain("chat_conversations.delete");
});
