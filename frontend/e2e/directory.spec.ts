/**
 * 사내 조직도 명부(company_directory) API 게이트 — 세션 불필요.
 * CLAUDE_OTEL_INGEST_TOKEN 은 환경변수 또는 frontend/.env.local. SUPABASE_SERVICE_ROLE_KEY 가 없으면 500 "server not configured"로 분기.
 */
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

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

test.describe("조직도 명부 API 게이트 (세션 불필요)", () => {
  test("세션 없이 GET /api/admin/directory → 401", async ({ request }) => {
    const r = await request.get("/api/admin/directory");
    expect(r.status()).toBe(401);
  });

  test("동기화 POST: 토큰 없음 → 401", async ({ request }) => {
    const r = await request.post("/api/admin/directory/sync", { data: { people: [] } });
    expect(r.status()).toBe(401);
  });

  test("동기화 POST: 토큰 있음 + people 누락/빈 배열 → 400 (서비스 키 없으면 500)", async ({ request }) => {
    test.skip(!TOKEN, "CLAUDE_OTEL_INGEST_TOKEN 미설정");
    const noPeople = await request.post("/api/admin/directory/sync", { headers: { Authorization: `Bearer ${TOKEN}` }, data: { nope: 1 } });
    expect(noPeople.status()).toBe(SERVICE_KEY ? 400 : 500);
    const empty = await request.post("/api/admin/directory/sync", { headers: { Authorization: `Bearer ${TOKEN}` }, data: { people: [] } });
    expect(empty.status()).toBe(SERVICE_KEY ? 400 : 500);
  });

  test("동기화 POST: 토큰 있음 + 명부가 너무 적음(force 없음) → 400, DB에 쓰지 않음", async ({ request }) => {
    test.skip(!TOKEN || !SERVICE_KEY, "토큰/서비스 키 미설정");
    const r = await request.post("/api/admin/directory/sync", {
      headers: { Authorization: `Bearer ${TOKEN}` },
      data: { people: [{ email: "e2e-directory@example.com", name: "E2E", deptPath: "(주)이노그리드>(주)이노그리드>경영지원부문" }] },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).error).toContain("너무 적습니다");
  });
});
