import { expect, it } from "vitest";
import { ACCESS_SUMMARY, describeScopes, loopbackWarning, redirectAllowed, redirectHost } from "@/lib/mcp/consent";

const WARN = "이 PC에서 실행 중인 프로그램(Claude Code)이 연결을 요청했습니다. 직접 연결을 시작한 경우에만 허용하세요.";

it("warns only for loopback redirect hosts", () => {
  expect(loopbackWarning("http://localhost:53122/callback")).toBe(WARN);
  expect(loopbackWarning("http://127.0.0.1:8080/callback")).toBe(WARN);
  expect(loopbackWarning("https://claude.ai/api/mcp/auth_callback")).toBeNull();
  expect(loopbackWarning("https://localhost.evil.com/cb")).toBeNull();
  expect(loopbackWarning("not a url")).toBeNull();
});

it("describes known scopes and keeps unknown ones as-is", () => {
  expect(describeScopes(["openid", "email", "profile", "offline_access", "custom"])).toEqual([
    "로그인 확인",
    "이메일 주소",
    "이름·프로필",
    "자동 갱신(다시 로그인 없이 유지)",
    "custom",
  ]);
  expect(describeScopes([])).toEqual([]);
});

it("extracts the redirect host (with port), falling back to the raw string", () => {
  expect(redirectHost("https://claude.ai/api/mcp/auth_callback")).toBe("claude.ai");
  expect(redirectHost("http://localhost:53122/callback")).toBe("localhost:53122");
  expect(redirectHost("garbage")).toBe("garbage");
});

it("allows only claude.ai, claude.com and loopback redirect hosts", () => {
  expect(redirectAllowed("https://claude.ai/api/mcp/auth_callback")).toBe(true);
  expect(redirectAllowed("https://app.claude.com/cb")).toBe(true);
  expect(redirectAllowed("http://localhost:52000/callback")).toBe(true);
  expect(redirectAllowed("http://127.0.0.1:1234/cb")).toBe(true);
  expect(redirectAllowed("https://evil.example/cb")).toBe(false);
  expect(redirectAllowed("https://claude.ai.evil.example/cb")).toBe(false);
  expect(redirectAllowed("http://claude.ai/cb")).toBe(false);
  expect(redirectAllowed("not a url")).toBe(false);
  expect(ACCESS_SUMMARY).toContain("아마란스");
});
