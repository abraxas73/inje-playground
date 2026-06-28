import { test, expect } from "@playwright/test";
import fs from "node:fs";

const STORAGE = process.env.SURVEY_E2E_STORAGE_STATE;
const SLUG = process.env.SURVEY_E2E_SLUG ?? "claude-code-productivity";
const hasAuth = !!STORAGE && fs.existsSync(STORAGE);

test.describe("설문 응답 플로우", () => {
  test.skip(!hasAuth, "SURVEY_E2E_STORAGE_STATE(로그인 storageState)가 필요합니다.");
  test.use({ storageState: hasAuth ? STORAGE : undefined });

  test("응답 제출 → 완료 → 재진입 시 중복 차단", async ({ page }) => {
    await page.goto(`/survey/${SLUG}`);
    await expect(page.getByTestId("survey-submit")).toBeVisible({ timeout: 15_000 });

    // number 입력 문항을 먼저 채운다(선택형 버튼과 겹치지 않음).
    const numberInputs = page.locator('input[type="number"]');
    const numCount = await numberInputs.count();
    for (let i = 0; i < numCount; i++) {
      await numberInputs.nth(i).fill("3");
    }

    // 제출 시도 → 표시된 첫 검증 에러(p.text-xs.text-destructive) 문항의
    // 첫·마지막 선택 버튼을 클릭해 결정적으로 보정하는 단일 루프.
    // (pre_post는 first=before행 첫 버튼, last=after행 마지막 버튼으로 양쪽 충족)
    for (let attempt = 0; attempt < 40; attempt++) {
      const completed = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
      const duplicated = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
      if (completed || duplicated) break;

      await page.getByTestId("survey-submit").click();
      await page.waitForTimeout(250);

      const completedNow = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
      const duplicatedNow = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
      if (completedNow || duplicatedNow) break;

      const firstError = page.locator("p.text-xs.text-destructive").first();
      if (!(await firstError.isVisible().catch(() => false))) continue;

      const container = firstError.locator("xpath=..");
      const optButtons = container.locator("button");
      const count = await optButtons.count();
      if (count > 0) {
        await optButtons.first().click();
        if (count > 1) await optButtons.last().click();
      }
    }

    const completed = await page.getByText("응답이 제출되었습니다.").isVisible().catch(() => false);
    const duplicated = await page.getByText("이미 제출한 설문입니다.").isVisible().catch(() => false);
    expect(completed || duplicated).toBeTruthy();

    // 재진입 → 제출 → 중복 차단
    await page.goto(`/survey/${SLUG}`);
    const submitBtn = page.getByTestId("survey-submit");
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
    }
    await expect(page.getByText("이미 제출한 설문입니다.")).toBeVisible({ timeout: 10_000 });
  });
});
