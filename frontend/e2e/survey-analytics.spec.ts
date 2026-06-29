/**
 * 분석 대시보드 E2E — 집계 카드·경영 요약·세그먼트 필터·CSV 다운로드
 *
 * Auth: Google OAuth 전용 앱이므로 email/password 폼 로그인 불가.
 *       E2E_ADMIN_STORAGE_STATE 에 admin storageState JSON 경로를 설정한다.
 *       미설정 시 SKIP (fake-pass 금지).
 *
 * Seed: SUPABASE_SERVICE_ROLE_KEY 로 직접 DB 삽입(6응답: dev 4 / pm 2, Δ+2).
 *       afterAll 에서 cleanupSurvey() 로 정리.
 *
 * storageState 녹화 방법:
 *   npx playwright codegen --save-storage=/tmp/admin-storage.json http://localhost:3003
 *   → Google 관리자 로그인 후 Ctrl+C
 *   export E2E_ADMIN_STORAGE_STATE=/tmp/admin-storage.json
 *   export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
 */

import { test, expect } from "@playwright/test";
import { ADMIN_STORAGE_STATE, hasAdminSession } from "./helpers/auth";
import { seedAnalyticsSurvey, cleanupSurvey, type SeededSurvey } from "./helpers/seed";

const serviceKeyAvailable = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
const canRun = hasAdminSession && serviceKeyAvailable;

const skipReason = [
  !hasAdminSession ? "E2E_ADMIN_STORAGE_STATE 미설정 또는 파일 없음" : "",
  !serviceKeyAvailable ? "SUPABASE_SERVICE_ROLE_KEY 미설정" : "",
]
  .filter(Boolean)
  .join(", ");

let seeded: SeededSurvey | null = null;

test.describe("분석 대시보드", () => {
  test.skip(!canRun, skipReason || "admin storageState + service role key 필요");
  test.use({ storageState: hasAdminSession ? ADMIN_STORAGE_STATE : undefined });

  test.beforeAll(async () => {
    // Guard: skip seeding if env not configured (describe-level skip may not block beforeAll)
    if (!canRun) return;
    seeded = await seedAnalyticsSurvey();
  });

  test.afterAll(async () => {
    if (seeded) {
      await cleanupSurvey(seeded.surveyId);
      seeded = null;
    }
  });

  test("집계 카드·경영 요약·세그먼트 필터·CSV 다운로드", async ({ page }) => {
    // Extra guard in case beforeAll was bypassed
    if (!seeded) {
      test.skip(true, "시드 데이터 없음 — 환경변수 미설정");
      return;
    }

    // ── 1. 대시보드 로드 ──────────────────────────────────────────────────────
    await page.goto(`/admin/surveys/${seeded.surveyId}/analytics`);

    // ── 2. 집계 카드 렌더 확인 ────────────────────────────────────────────────
    // 별도 spinner-wait 없이 aggregate-card toBeVisible 의 web-first auto-retry 가
    // 로딩 완료(집계 API 응답)를 흡수한다.
    // data-testid="aggregate-card" (QuestionAggregateCard) 기준으로 확인
    // (segment filter 버튼도 "직무" 텍스트를 가지므로 testid로 구분)
    await expect(
      page.getByTestId("aggregate-card").filter({ hasText: "직무" }).first()
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByTestId("aggregate-card").filter({ hasText: "생산성" }).first()
    ).toBeVisible();

    // PrePostBars 렌더: "도입 전" 레이블 + Δ+2 배지
    // before=2, after=4 → delta_mean=2, improvement_pct=100
    await expect(page.getByText("도입 전").first()).toBeVisible();
    // "Δ +2 (100%↑)" — \b 경계로 +20 등 오매칭 방지
    await expect(page.getByText(/Δ \+2\b/).first()).toBeVisible();

    // ── 3. 경영 요약 탭 전환 ─────────────────────────────────────────────────
    await page.getByRole("tab", { name: /경영 요약/ }).click();

    // KPI 카드: pre_post_overall label + display
    await expect(page.getByText("도입 전후 개선 Δ")).toBeVisible({ timeout: 10_000 });
    // display = "+2 (100%↑)" — \b 경계로 +20 등 오매칭 방지
    await expect(page.getByText(/\+2\b/).first()).toBeVisible();

    // ── 4. 집계 대시보드 탭 복귀 + 세그먼트 필터 (직무 = 개발) ───────────────
    await page.getByRole("tab", { name: /집계 대시보드/ }).click();

    // SegmentFilterBar: role="button" name="직무" (CardTitle은 button 아님)
    await page.getByRole("button", { name: "직무" }).click();
    // Popover 내 "개발" 체크박스 — role=checkbox 로 scope(차트 라벨 텍스트와 충돌 방지).
    // shadcn Checkbox(role=checkbox)를 감싼 <label>이 접근성 이름 "개발"을 제공.
    await page.getByRole("checkbox", { name: "개발" }).click();
    // Popover 닫기
    await page.keyboard.press("Escape");

    // dev 4건 → 집계 재요청 → Badge "n=4" 표시
    // (n<5 이면 카드 바디는 마스킹되지만 Badge는 항상 n값 표시)
    await expect(page.getByText(/n=4/).first()).toBeVisible({ timeout: 15_000 });

    // ── 5. CSV 다운로드 ────────────────────────────────────────────────────────
    // page.request는 storageState 쿠키를 공유하므로 admin 인증 가능 (API 체크 시 사용)
    // 다운로드 이벤트 대기 — <a href="..." download> 클릭으로 트리거
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: /전체 CSV/ }).click(),
    ]);
    // Content-Disposition: attachment; filename*=UTF-8''<slug>-all.csv
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  });
});
