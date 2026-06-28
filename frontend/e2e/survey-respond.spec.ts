import { test, expect } from "@playwright/test";
import fs from "node:fs";

const STORAGE = process.env.SURVEY_E2E_STORAGE_STATE;
const SLUG = process.env.SURVEY_E2E_SLUG ?? "claude-code-productivity";
const hasAuth = !!STORAGE && fs.existsSync(STORAGE);

// 제출-보정 루프 상한: 25문항 설문에서 문항별 1회 보정 + 여유분.
const MAX_CORRECTION_ATTEMPTS = 40;

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

    const complete = page.getByTestId("survey-complete");
    const duplicate = page.getByTestId("survey-duplicate");
    const fieldError = page.getByTestId("field-error");

    // 제출 시도 → 표시된 첫 검증 에러(field-error) 문항의
    // 첫·마지막 선택 버튼을 클릭해 결정적으로 보정하는 단일 루프.
    // (pre_post는 first=before행 첫 버튼, last=after행 마지막 버튼으로 양쪽 충족)
    for (let attempt = 0; attempt < MAX_CORRECTION_ATTEMPTS; attempt++) {
      if (await complete.isVisible()) break;
      if (await duplicate.isVisible()) break;

      await page.getByTestId("survey-submit").click();
      // 하드코딩 sleep 대신 web-first assertion: 완료/중복/검증에러 중
      // 하나가 보일 때까지 Playwright가 auto-retry.
      await expect(
        page
          .locator(
            "[data-testid='field-error'], [data-testid='survey-complete'], [data-testid='survey-duplicate']",
          )
          .first(),
      ).toBeVisible({ timeout: 5_000 });

      if (await complete.isVisible()) break;
      if (await duplicate.isVisible()) break;

      const firstError = fieldError.first();
      if (!(await firstError.isVisible())) continue;

      // 첫 에러를 포함한 질문 컨테이너 = DOM 순서상 첫 에러 보유 컨테이너.
      const container = page.getByTestId("question-container").filter({ has: fieldError }).first();
      const optButtons = container.locator("button");
      const count = await optButtons.count();
      if (count > 0) {
        await optButtons.first().click();
        if (count > 1) await optButtons.last().click();
      }
    }

    // first-submission 완료 경로를 강제 검증한다.
    // 기존 응답이 있으면(테스트 user가 이미 제출) 중복 화면만 검증한다.
    if (await duplicate.isVisible()) {
      test.info().annotations.push({
        type: "note",
        description: "이미 제출됨 — 재진입 차단만 검증",
      });
    } else {
      await expect(complete).toBeVisible();
    }

    // 재진입 → 제출 → 중복 차단
    await page.goto(`/survey/${SLUG}`);
    const submitBtn = page.getByTestId("survey-submit");
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
    }
    await expect(page.getByTestId("survey-duplicate")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("이미 제출한 설문입니다.")).toBeVisible();
  });
});
