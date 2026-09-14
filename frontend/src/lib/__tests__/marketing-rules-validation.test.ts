// @vitest-environment node
import { expect, it, vi } from "vitest";
import { applyRules } from "@/lib/marketing/rules";
import { emptyContact } from "@/lib/marketing/types";
import { validateContact } from "@/lib/marketing/validation";
it("retains rule versions and routes rule failures to confirmation-needed", async () => {
  const data = { ...emptyContact(), company: "한빛", name: "김담당", email: "a@example.test" };
  const check = { version: "v2", rules: [{ id: "r", version: 2 }], violations: [{ id: "r", code: "CUSTOM", version: 2, severity: "error", message: "연락처 필수" }, { id: "m", code: "EXCEL-04", version: 1, severity: "warning", message: "발송 정제 확인" }] };
  const rpc = vi.fn().mockResolvedValue({ data: check });
  const result = await applyRules({ rpc } as unknown as Parameters<typeof applyRules>[0], data, validateContact(data, [], []));
  expect(result).toMatchObject({ kind: "확인 필요", ruleCheck: check, ruleVersion: expect.stringContaining("DB:v2"), errors: expect.arrayContaining(["[CUSTOM v2] 연락처 필수"]), reasons: expect.arrayContaining(["[담당자 확인 · EXCEL-04 v1] 발송 정제 확인"]) });
  rpc.mockResolvedValue({ data: { ...check, violations: [{ ...check.violations[1], manual: true }] } });
  const update = { ...validateContact(data, [], []), kind: "기존 정보 업데이트" as const };
  expect((await applyRules({ rpc } as unknown as Parameters<typeof applyRules>[0], data, update)).kind).toBe("기존 정보 업데이트");
  rpc.mockResolvedValue({ data: null });
  await expect(applyRules({ rpc } as unknown as Parameters<typeof applyRules>[0], data, validateContact(data, [], []))).rejects.toThrow("관리 규칙을 불러오지 못했습니다");
});
