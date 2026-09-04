import { describe, it, expect } from "vitest";
import { normalizeHttpUrl } from "@/lib/rfp/url";

describe("normalizeHttpUrl", () => {
  it("비어 있으면 null", () => {
    expect(normalizeHttpUrl(undefined)).toEqual({ ok: true, value: null });
    expect(normalizeHttpUrl(null)).toEqual({ ok: true, value: null });
    expect(normalizeHttpUrl("")).toEqual({ ok: true, value: null });
  });

  it("앞뒤 공백을 trim한다", () => {
    expect(normalizeHttpUrl("  https://example.com  ")).toEqual({ ok: true, value: "https://example.com" });
  });

  it("공백만 있으면 null", () => {
    expect(normalizeHttpUrl("   ")).toEqual({ ok: true, value: null });
  });

  it("javascript: 스킴을 거부한다", () => {
    const r = normalizeHttpUrl("javascript:alert(1)");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/http\(s\)/);
  });

  it("data: 스킴을 거부한다", () => {
    expect(normalizeHttpUrl("data:text/html,<script>alert(1)</script>").ok).toBe(false);
  });

  it("대문자 스킴(HTTPS://)을 허용한다", () => {
    expect(normalizeHttpUrl("HTTPS://example.com")).toEqual({ ok: true, value: "HTTPS://example.com" });
  });

  it("2000자를 넘으면 거부한다", () => {
    const long = `https://example.com/${"a".repeat(2001 - "https://example.com/".length)}`;
    expect(long.length).toBe(2001);
    const r = normalizeHttpUrl(long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2000/);
  });

  it("숫자 등 문자열이 아닌 타입을 거부한다", () => {
    const r = normalizeHttpUrl(123);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/문자열/);
  });
});
