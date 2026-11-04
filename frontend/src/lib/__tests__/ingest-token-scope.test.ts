// @vitest-environment node
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** 사용량 수집 토큰(CLAUDE_OTEL_INGEST_TOKEN)은 Claude Code 관리형 설정으로 직원 PC 전부에 배포된다 — 수집(OTLP) 외 API가 받으면 안 된다(2026-11-04). */
const ALLOWED = ["app/api/otel/", "app/api/admin/claude-usage/health/", "lib/claude-usage/"];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

describe("사용량 수집 토큰 사용 범위", () => {
  it("OTLP 수집·상태 확인 밖의 API는 CLAUDE_OTEL_INGEST_TOKEN을 받지 않는다", () => {
    const src = path.join(__dirname, "..", "..");
    const offenders = files(path.join(src, "app", "api"))
      .filter((f) => fs.readFileSync(f, "utf8").includes("process.env.CLAUDE_OTEL_INGEST_TOKEN"))
      .map((f) => path.relative(src, f))
      .filter((f) => !ALLOWED.some((a) => f.startsWith(a)));
    expect(offenders).toEqual([]);
  });
});
