/**
 * Claude 사용량 대시보드 E2E
 *
 * 1) OTLP 수신·관리자 API 게이트 — 세션 불필요, 어디서나 실행.
 *    CLAUDE_OTEL_INGEST_TOKEN 은 환경변수 또는 frontend/.env.local 에서 읽는다(dev 서버와 동일 값).
 *    SUPABASE_SERVICE_ROLE_KEY 가 없으면 서버가 500 "server not configured"를 돌려주므로 기대값을 분기한다.
 * 2) 관리자 화면 흐름 — Google OAuth 전용 앱이라 E2E_ADMIN_STORAGE_STATE(admin storageState JSON)가 필요. 미설정 시 SKIP.
 *    합성 CSV 업로드 테스트는 SUPABASE_SERVICE_ROLE_KEY 도 필요(서버 쓰기 + afterAll 정리).
 *
 * storageState 녹화: npx playwright codegen --save-storage=/tmp/admin-storage.json http://localhost:3003
 */

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_STORAGE_STATE, hasAdminSession } from "./helpers/auth";

function readEnvLocal(key: string): string | undefined {
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

const TOKEN = process.env.CLAUDE_OTEL_INGEST_TOKEN ?? readEnvLocal("CLAUDE_OTEL_INGEST_TOKEN");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? readEnvLocal("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? readEnvLocal("NEXT_PUBLIC_SUPABASE_URL");
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe("OTLP 수신 게이트 (세션 불필요)", () => {
  test("토큰 없음/불일치 → 401 (metrics·logs 모두)", async ({ request }) => {
    const noToken = await request.post("/api/otel/v1/metrics", { data: {} });
    expect(noToken.status()).toBe(401);
    const wrong = await request.post("/api/otel/v1/logs", { headers: auth("wrong-token-000000"), data: {} });
    expect(wrong.status()).toBe(401);
  });

  test("올바른 토큰: JSON 아닌 본문 415, 깨진 JSON 400", async ({ request }) => {
    test.skip(!TOKEN, "CLAUDE_OTEL_INGEST_TOKEN 미설정");
    const r415 = await request.post("/api/otel/v1/metrics", {
      headers: { ...auth(TOKEN!), "Content-Type": "application/x-protobuf" },
      data: Buffer.from("x"),
    });
    expect(r415.status()).toBe(415);
    // 문자열 data는 Playwright가 JSON 문자열 리터럴로 직렬화할 수 있어 원시 바이트로 보낸다
    const r400 = await request.post("/api/otel/v1/logs", {
      headers: { ...auth(TOKEN!), "Content-Type": "application/json" },
      data: Buffer.from("{not json"),
    });
    expect(r400.status(), await r400.text()).toBe(400);
  });

  test("올바른 토큰 + 빈 배치 → 200 {} (서비스 키 없으면 500 server not configured)", async ({ request }) => {
    test.skip(!TOKEN, "CLAUDE_OTEL_INGEST_TOKEN 미설정");
    const r = await request.post("/api/otel/v1/metrics", {
      headers: { ...auth(TOKEN!), "Content-Type": "application/json" },
      data: { resourceMetrics: [] },
    });
    if (SERVICE_KEY) {
      expect(r.status()).toBe(200);
      expect(await r.json()).toEqual({});
    } else {
      expect(r.status()).toBe(500);
      expect((await r.json()).error).toBe("server not configured");
    }
  });
});

test.describe("관리자 API 게이트 (세션 불필요)", () => {
  test("세션 없이 GET → 401", async ({ request }) => {
    for (const p of ["summary", "members", "imports", "orgs", "health", "org-members", "tools", "hourly"]) {
      const r = await request.get(`/api/admin/claude-usage/${p}`);
      expect(r.status(), p).toBe(401);
    }
  });

  test("imports POST: 토큰 인증 통과 후 파일 없음 → 400 (서비스 키 없으면 500)", async ({ request }) => {
    test.skip(!TOKEN, "CLAUDE_OTEL_INGEST_TOKEN 미설정");
    const r = await request.post("/api/admin/claude-usage/imports", { headers: auth(TOKEN!), multipart: { note: "no-files" } });
    expect(r.status()).toBe(SERVICE_KEY ? 400 : 500);
  });
});

const E2E_ORG = "e2e00000-0000-4000-8000-000000000001";

test.describe("관리자 화면 (admin storageState 필요)", () => {
  test.skip(!hasAdminSession, "E2E_ADMIN_STORAGE_STATE 미설정 또는 파일 없음");
  test.use({ storageState: hasAdminSession ? ADMIN_STORAGE_STATE : undefined });

  test("3탭 렌더·수집 상태·관리형 설정 JSON", async ({ page }) => {
    await page.goto("/admin/claude-usage");
    await expect(page.getByRole("heading", { name: "Claude 사용량" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Claude Code" })).toBeVisible();
    await page.getByRole("tab", { name: "조직 · 설정" }).click();
    await expect(page.getByText("수집 상태")).toBeVisible();
    await expect(page.locator("pre")).toContainText("OTEL_EXPORTER_OTLP_ENDPOINT");
    await expect(page.locator("pre")).toContainText("/api/otel");
    await page.getByRole("tab", { name: "채팅 · Cowork (CSV)" }).click();
    await expect(page.getByText("멤버 활동 CSV 업로드")).toBeVisible();
  });

  test.describe("합성 CSV 업로드", () => {
    test.skip(!SERVICE_KEY || !SUPABASE_URL, "SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL 미설정");

    test.afterAll(async () => {
      if (!SERVICE_KEY || !SUPABASE_URL) return;
      const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
      await admin.from("claude_csv_imports").delete().eq("org_id", E2E_ORG);
      await admin.from("claude_orgs").delete().eq("id", E2E_ORG);
    });

    test("파일명 자동 인식 업로드 → 표 반영(미할당 표시) → 이력 삭제", async ({ page }) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-usage-e2e-"));
      const file = path.join(dir, `members-analytics-${E2E_ORG}-2026-01-01-to-2026-01-30.csv`);
      fs.writeFileSync(
        file,
        "﻿" +
          '"Name","Email","Role","Seat Tier","Last Active","Days Active","Chats","Messages","Projects Created","Projects Used","Pull Requests","Code sessions","File Edits","Cowork Sessions","Cowork Messages","Artifacts Created","Claude Code Artifacts","Cowork Artifacts","Estimated Spend (USD)"\r\n' +
          '"E2E 활동","dev-e2e-1@example.com","User","Premium","2026-01-29","3","5","12","0","0","0","7","0","1","4","0","0","0","0.00"\r\n' +
          '"E2E 미할당","dev-e2e-2@example.com","User","Unassigned","","0","0","0","0","0","0","0","0","0","0","0","0","0","0.00"\r\n'
      );

      await page.goto("/admin/claude-usage");
      await page.getByRole("tab", { name: "채팅 · Cowork (CSV)" }).click();
      await page.locator('input[type="file"]').setInputFiles(file);
      await expect(page.getByText(/✓ members-analytics-e2e00000/)).toBeVisible({ timeout: 15_000 });

      // 업로드된 조직만 보기
      await page.getByRole("combobox").first().click();
      await page.getByRole("option", { name: /e2e00000/ }).click();
      await expect(page.getByText("dev-e2e-1@example.com")).toBeVisible();
      await expect(page.getByText("dev-e2e-2@example.com")).toBeVisible();
      await expect(page.getByText("미할당")).toBeVisible();

      // 이력 삭제 → 표에서 사라짐
      await page.getByRole("button", { name: "삭제" }).first().click();
      await expect(page.getByText("dev-e2e-1@example.com")).toHaveCount(0, { timeout: 15_000 });
    });
  });
});
