import { describe, it, expect } from "vitest";
import { verifyIngestToken } from "@/lib/claude-usage/ingest-auth";

describe("verifyIngestToken", () => {
  it("Bearer 토큰이 기대값과 같을 때만 true", () => {
    expect(verifyIngestToken("Bearer abc12345", "abc12345")).toBe(true);
    expect(verifyIngestToken("bearer abc12345", "abc12345")).toBe(true);
    expect(verifyIngestToken("Bearer abc12346", "abc12345")).toBe(false);
    expect(verifyIngestToken("Bearer abc1234", "abc12345")).toBe(false);
    expect(verifyIngestToken("abc12345", "abc12345")).toBe(false);
    expect(verifyIngestToken(null, "abc12345")).toBe(false);
  });
  it("서버에 토큰이 설정되지 않았거나 8자 미만이면 항상 false", () => {
    expect(verifyIngestToken("Bearer x", undefined)).toBe(false);
    expect(verifyIngestToken("Bearer short", "short")).toBe(false);
  });
});
