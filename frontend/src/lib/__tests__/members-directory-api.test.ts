// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, rows: [] as unknown[], error: null as { message: string } | null }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: { from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: m.rows, error: m.error }) }) }) }) } }
  : { ok: false, response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) } }));
import { GET } from "@/app/api/members/directory/route";
beforeEach(() => { m.ok = true; m.error = null; m.rows = [
  { email: "lee@innogrid.com", name: "이서연", team: "클라우드 네이티브 센터", units: ["기술·운영부문", "AX본부", "클라우드 네이티브 센터"] },
  { email: "kang@innogrid.com", name: "강승욱", team: "XPU플랫폼팀", units: ["기술·운영부문", "AX본부", "XPU플랫폼팀"] },
  { email: "", name: "이메일없음", team: null, units: null },
]; });

it("활성 명부를 Member[]로(id=email, 이름 가나다순, 조직 경로 units 포함), 이메일 없는 행은 뺀다 — RLS가 admin 전용이라 service role로 읽는다", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ members: [
    { id: "kang@innogrid.com", name: "강승욱", email: "kang@innogrid.com", team: "XPU플랫폼팀", units: ["기술·운영부문", "AX본부", "XPU플랫폼팀"] },
    { id: "lee@innogrid.com", name: "이서연", email: "lee@innogrid.com", team: "클라우드 네이티브 센터", units: ["기술·운영부문", "AX본부", "클라우드 네이티브 센터"] },
  ], source: "directory" });
});
it("명부가 비어 있으면(동기화 전) 503과 안내", async () => {
  m.rows = [];
  const res = await GET();
  expect(res.status).toBe(503);
  expect((await res.json()).error).toContain("조직도");
});
it("비로그인·guest는 requireUser 응답 그대로", async () => { m.ok = false; expect((await GET()).status).toBe(401); });
