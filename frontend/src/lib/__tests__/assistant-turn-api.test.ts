// @vitest-environment node
import { expect, it } from "vitest";
import { POST } from "@/app/api/assistant/turn/route";

it("1.7.0 미만 앱의 예전 턴 API — Claude를 부르지 않고 업데이트 안내(426, 예전 앱은 error 문구를 대화창에 그대로 보인다)", async () => {
  const res = await POST();
  expect(res.status).toBe(426);
  const j = await res.json();
  expect(j.code).toBe("app_update_required");
  expect(j.error).toContain("업데이트");
  expect(j.error).toContain("innocrew.innogrid.com/apps");
  expect(j).not.toHaveProperty("enabled");
});
