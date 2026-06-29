/**
 * 관리자 설문 빌더 E2E — 생성 → 문항 3종 추가 → 순서변경 → open 전환 → 노출 확인
 *
 * Auth: Google OAuth 전용 앱이므로 email/password 폼 로그인 불가.
 *       admin storageState JSON 파일 경로를 E2E_ADMIN_STORAGE_STATE 에 설정한다.
 *       파일이 없으면 테스트를 SKIP (fake-pass 금지).
 *
 * 파일 녹화 방법:
 *   npx playwright codegen --save-storage=/tmp/admin-storage.json http://localhost:3003
 *   → Google 로그인 후 Ctrl+C
 *   export E2E_ADMIN_STORAGE_STATE=/tmp/admin-storage.json
 */

import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, hasAdminSession } from "./helpers/auth";

// 고유 slug — 동일 DB 환경 재실행 시 충돌 방지를 위해 timestamp 포함.
const slug = `e2e-builder-${Date.now()}`;

test.describe("관리자 설문 빌더", () => {
  test.skip(!hasAdminSession, "E2E_ADMIN_STORAGE_STATE 미설정 또는 파일 없음 — admin storageState 필요");
  test.use({ storageState: ADMIN_STORAGE_STATE });

  test("생성 → 문항 3종 추가 → 순서변경 → open 전환 → 노출", async ({ page }) => {
    // ── 1. 새 설문 생성 ──────────────────────────────────────────────────────
    await page.goto("/admin/surveys/new");

    await page.getByLabel("제목").fill("E2E 빌더 테스트");
    await page.getByLabel("slug (URL 경로)").fill(slug);
    await page.getByRole("button", { name: "생성 후 문항 편집" }).click();

    // 편집 페이지로 이동 확인
    await expect(page).toHaveURL(/\/admin\/surveys\/[0-9a-f-]+\/edit/, { timeout: 15_000 });

    // ── 2. 문항 3종 추가 (single_choice, scale, nps) ─────────────────────────
    // 페이지 초기 로딩 완료 대기 (빈 상태 안내 문구 또는 빌더 영역)
    const addArea = page.getByTestId("question-add-area");
    await expect(addArea).toBeVisible({ timeout: 15_000 });

    // 객관식 단일 (single_choice)
    await addArea.getByRole("button", { name: /객관식 단일/i }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(1, { timeout: 10_000 });

    // 척도 (scale — label: "척도(Likert)")
    await addArea.getByRole("button", { name: /척도/i }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(2, { timeout: 10_000 });

    // NPS (nps — label: "NPS(0~10)")
    await addArea.getByRole("button", { name: /NPS/i }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(3, { timeout: 10_000 });

    // 추가 직후 순서: [single_choice, scale, nps]
    const rows = page.getByTestId("survey-question-row");
    await expect(rows.nth(0)).toHaveAttribute("data-question-type", "single_choice");
    await expect(rows.nth(1)).toHaveAttribute("data-question-type", "scale");
    await expect(rows.nth(2)).toHaveAttribute("data-question-type", "nps");

    // ── 3. 순서변경 — 마지막(NPS) 문항을 한 칸 위로 이동 ──────────────────
    await rows.nth(2).getByRole("button", { name: "위로" }).click();
    // 이동 후에도 3개 유지 + nps가 2번째(index 1)로 올라왔는지 실제 순서 검증.
    await expect(page.getByTestId("survey-question-row")).toHaveCount(3, { timeout: 10_000 });
    await expect(page.getByTestId("survey-question-row").nth(1)).toHaveAttribute(
      "data-question-type",
      "nps",
      { timeout: 10_000 },
    );
    // scale은 3번째(index 2)로 밀려난다.
    await expect(page.getByTestId("survey-question-row").nth(2)).toHaveAttribute(
      "data-question-type",
      "scale",
    );

    // ── 4. draft → open 전환 ─────────────────────────────────────────────────
    await page.getByRole("button", { name: "공개" }).click();
    await expect(page.getByTestId("survey-status-badge")).toHaveText(/진행중/, {
      timeout: 10_000,
    });

    // ── 5. 노출 확인 — 공개 API가 open 설문 + 문항 3개 반환 ─────────────────
    // page.request는 브라우저 컨텍스트(storageState 쿠키)를 공유한다 →
    // authenticated 설문도 admin 세션으로 200 응답.
    const res = await page.request.get(`/api/surveys/${slug}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.questions).toHaveLength(3);
  });
});
