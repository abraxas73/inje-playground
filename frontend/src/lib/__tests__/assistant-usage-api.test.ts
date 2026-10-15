// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ tables: {} as Record<string, { data: unknown[] | null; error: { message: string } | null }>, calls: [] as Array<[string, ...unknown[]]> }));
const from = (table: string) => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "gte", "order", "eq", "in"]) chain[k] = (...a: unknown[]) => { m.calls.push([`${table}.${k}`, ...a]); return chain; };
  chain.range = async () => { const r = m.tables[table] ?? { data: [], error: null }; return { ...r, count: r.data?.length ?? 0 }; };
  chain.then = (res: (x: unknown) => unknown) => Promise.resolve(m.tables[table]).then(res);
  return chain;
};
vi.mock("@/lib/claude-usage/require-admin", () => ({ requireAdmin: async () => ({ ok: true, userId: "admin" }), adminClientOr500: () => ({ ok: true, admin: { from } }) }));
import { GET } from "@/app/api/admin/assistant-usage/route";
const get = () => GET(new NextRequest("http://localhost/api/admin/assistant-usage?days=7"));

beforeEach(() => {
  m.calls = [];
  m.tables = {
    assistant_usage: { data: [{ user_id: "u1", day: "2026-10-15", turns: 3, input_tokens: 10, output_tokens: 5, model_turns: {}, masked: 0 }], error: null },
    user_profiles: { data: [{ user_id: "u1", display_name: "강", email: "Kang@Innogrid.com" }, { user_id: "u2", display_name: "다른", email: "x@innogrid.com" }], error: null },
    company_directory: { data: [{ email: "KANG@innogrid.com", team: "플랫폼팀" }], error: null },
  };
});

it("프로필·조직도를 .in() 없이 전부 읽어 메모리에서 조인(이메일 대소문자 무시, 재직자만)", async () => {
  const r = await get();
  expect(r.status).toBe(200);
  const j = await r.json();
  expect(j.users[0]).toMatchObject({ userId: "u1", name: "강", email: "kang@innogrid.com", team: "플랫폼팀" });
  expect(m.calls.some((c) => c[0].endsWith(".in"))).toBe(false);
  expect(m.calls).toContainEqual(["company_directory.eq", "active", true]);
});
it("프로필·조직도 조회 오류면 500", async () => {
  m.tables.company_directory = { data: null, error: { message: "boom" } };
  expect((await get()).status).toBe(500);
  m.tables.company_directory = { data: [], error: null };
  m.tables.user_profiles = { data: null, error: { message: "boom" } };
  expect((await get()).status).toBe(500);
});
