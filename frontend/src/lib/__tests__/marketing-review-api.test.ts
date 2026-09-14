// @vitest-environment node
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const m = vi.hoisted(() => ({ rpc: vi.fn(), submission: { id: "s1", version: 2, status: "pending", data: { company: "한빛", name: "", email: "bad" }, target_id: null, clear_fields: [], validation: { ai: { status: "unavailable", reason: "후속 단계" } } } }));
vi.mock("@/lib/marketing/server", async original => ({ ...await original<typeof import("@/lib/marketing/server")>(), marketingAuth: async () => ({ db: { rpc: m.rpc, from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: m.submission }) }) }) }) } }), snapshot: async () => ({ contacts: [], organizations: [] }) }));
import { POST } from "@/app/api/marketing/review/route";
it("keeps invalid intake confirmation-needed on inspection even when another pending submission matches", async () => {
  m.rpc.mockImplementation(async (name, params) => ({ data: name === "marketing_validate_rules" ? { version: "test-rules", rules: [], violations: [{ id: "name", code: "BASE-NAME", version: 2, severity: "error", manual: false, message: "성명 누락" }, { id: "email", code: "BASE-EMAIL-FORMAT", version: 2, severity: "error", manual: false, message: "이메일 형식 오류" }] } : name === "marketing_pending_duplicate" ? true : { ...m.submission, version: 3, validation: params.p_validation } }));
  const response = await POST(new NextRequest("https://app.test/api/marketing/review", { method: "POST", body: JSON.stringify({ action: "inspect", id: "s1" }) }));
  expect(response.status).toBe(200);
  expect((await response.json()).validation).toMatchObject({ kind: "확인 필요", errors: ["[BASE-NAME v2] 성명 누락", "[BASE-EMAIL-FORMAT v2] 이메일 형식 오류"], reasons: expect.arrayContaining(["다른 검수 대기 제출과 겹치는 정보가 있습니다."]) });
  expect(m.rpc).toHaveBeenCalledWith("marketing_revalidate", expect.objectContaining({ p_validation: expect.objectContaining({ kind: "확인 필요" }) }));
});
