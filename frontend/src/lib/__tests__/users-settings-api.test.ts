// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const m = vi.hoisted(() => ({ rows: [] as Array<{ key: string; value: string }>, upserts: [] as unknown[], keyFilter: null as string | null }));
vi.mock("@/lib/supabase-server", () => ({
  createServerSupabase: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => {
      const q = {
        select: () => q,
        eq: (col: string, v: string) => { if (col === "key") m.keyFilter = v; return q; },
        then: (res: (v: unknown) => void) => res({ data: m.rows.filter((r) => !m.keyFilter || r.key === m.keyFilter), error: null }),
        upsert: async (row: unknown) => { m.upserts.push(row); return { error: null }; },
      };
      return q;
    },
  }),
}));
import { GET, PUT } from "@/app/api/users/settings/route";

beforeEach(() => { m.rows = [{ key: "dooray_token", value: "secret" }, { key: "innobot_button", value: "off" }]; m.upserts = []; m.keyFilter = null; });
const put = (b: unknown) => PUT(new NextRequest("https://a.test/api/users/settings", { method: "PUT", body: JSON.stringify(b) }));

it("GET ?key= 는 그 키만 돌려준다(다른 비밀 설정을 함께 내보내지 않음)", async () => {
  const j = await (await GET(new NextRequest("https://a.test/api/users/settings?key=innobot_button"))).json();
  expect(j).toEqual({ innobot_button: "off" });
});
it("GET 키 없이 부르면 전체(기존 동작)", async () => {
  const j = await (await GET(new NextRequest("https://a.test/api/users/settings"))).json();
  expect(Object.keys(j).sort()).toEqual(["dooray_token", "innobot_button"]);
});
it("innobot_button 은 on|off 만 저장", async () => {
  expect((await put({ key: "innobot_button", value: "off" })).status).toBe(200);
  expect((await put({ key: "innobot_button", value: "on" })).status).toBe(200);
  expect((await put({ key: "innobot_button", value: "maybe" })).status).toBe(400);
  expect(m.upserts).toHaveLength(2);
});
