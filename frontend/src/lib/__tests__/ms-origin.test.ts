import { describe, it, expect } from "vitest";
import { DEFAULT_ALLOWED_ORIGINS, DEFAULT_RETURN_TO, allowedOrigins, requestOrigin, resolveRedirectOrigin, sanitizeReturnTo, appendQuery } from "@/lib/ms/origin";

describe("requestOrigin", () => {
  const req = (origin: string, headers: Record<string, string>) => ({ nextUrl: { origin }, headers: { get: (k: string) => headers[k.toLowerCase()] ?? null } });
  it("x-forwarded-proto/host가 둘 다 있으면 그것을(첫 값), 아니면 nextUrl.origin", () => {
    expect(requestOrigin(req("http://localhost:3003", {}))).toBe("http://localhost:3003");
    expect(requestOrigin(req("http://10.0.0.1:3000", { "x-forwarded-proto": "https", "x-forwarded-host": "inje-playground.vercel.app" }))).toBe("https://inje-playground.vercel.app");
    expect(requestOrigin(req("http://10.0.0.1:3000", { "x-forwarded-proto": "https, http", "x-forwarded-host": "a.example, b.example" }))).toBe("https://a.example");
    expect(requestOrigin(req("http://localhost:3003", { "x-forwarded-host": "evil.example" }))).toBe("http://localhost:3003");
  });
});

describe("allowedOrigins / resolveRedirectOrigin", () => {
  it("env가 없으면 운영 도메인 + localhost:3003", () => {
    expect(allowedOrigins({})).toEqual(["https://inje-playground.vercel.app", "http://localhost:3003"]);
    expect(DEFAULT_ALLOWED_ORIGINS).toEqual(["https://inje-playground.vercel.app", "http://localhost:3003"]);
  });
  it("env는 쉼표 구분, 공백·끝 슬래시 정리", () => {
    expect(allowedOrigins({ MS_ALLOWED_ORIGINS: " https://a.example/ , http://localhost:3000 ,, " })).toEqual(["https://a.example", "http://localhost:3000"]);
  });
  it("허용 목록에 있는 오리진만 통과(끝 슬래시 무시), 나머지는 null", () => {
    expect(resolveRedirectOrigin("http://localhost:3003", {})).toBe("http://localhost:3003");
    expect(resolveRedirectOrigin("https://inje-playground.vercel.app/", {})).toBe("https://inje-playground.vercel.app");
    expect(resolveRedirectOrigin("https://inje-playground-git-x.vercel.app", {})).toBeNull();
    expect(resolveRedirectOrigin("http://localhost:3000", {})).toBeNull();
    expect(resolveRedirectOrigin("http://localhost:3000", { MS_ALLOWED_ORIGINS: "http://localhost:3000" })).toBe("http://localhost:3000");
  });
});

describe("sanitizeReturnTo", () => {
  it("같은 오리진 경로만 받고 나머지는 /settings", () => {
    expect(DEFAULT_RETURN_TO).toBe("/settings");
    expect(sanitizeReturnTo("/rfp/abc?tab=1")).toBe("/rfp/abc?tab=1");
    expect(sanitizeReturnTo("/settings")).toBe("/settings");
    expect(sanitizeReturnTo(undefined)).toBe("/settings");
    expect(sanitizeReturnTo(null)).toBe("/settings");
    expect(sanitizeReturnTo("")).toBe("/settings");
    expect(sanitizeReturnTo("//evil.example/x")).toBe("/settings");
    expect(sanitizeReturnTo("https://evil.example/x")).toBe("/settings");
    expect(sanitizeReturnTo("/a\\b")).toBe("/settings");
    expect(sanitizeReturnTo("/x?u=https://evil")).toBe("/settings");
    expect(sanitizeReturnTo("javascript:alert(1)")).toBe("/settings");
    expect(sanitizeReturnTo("/" + "a".repeat(500))).toBe("/settings");
  });
});

describe("appendQuery", () => {
  it("?와 &를 골라 붙이고 값은 인코딩한다", () => {
    expect(appendQuery("/settings", "ms_connected", "1")).toBe("/settings?ms_connected=1");
    expect(appendQuery("/rfp/x?tab=1", "ms_error", "연결이 취소되었습니다.")).toBe("/rfp/x?tab=1&ms_error=%EC%97%B0%EA%B2%B0%EC%9D%B4%20%EC%B7%A8%EC%86%8C%EB%90%98%EC%97%88%EC%8A%B5%EB%8B%88%EB%8B%A4.");
  });
});
