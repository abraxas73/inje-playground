// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseEncKey, encryptSecret, decryptSecret, signState, verifyState, newNonce, STATE_TTL_S } from "@/lib/ms/crypto";

const KEY_HEX = "0123456789abcdef".repeat(4); // 64자
const key = parseEncKey(KEY_HEX)!;
const other = parseEncKey("f".repeat(64))!;

describe("parseEncKey", () => {
  it("64자 hex만 32바이트 키로 받는다(공백 허용, 대문자 허용)", () => {
    expect(key).toHaveLength(32);
    expect(parseEncKey(` ${KEY_HEX.toUpperCase()} `)).toHaveLength(32);
    expect(parseEncKey(undefined)).toBeNull();
    expect(parseEncKey("abc")).toBeNull();
    expect(parseEncKey("g".repeat(64))).toBeNull();
    expect(parseEncKey("0".repeat(63))).toBeNull();
  });
});

describe("encryptSecret/decryptSecret", () => {
  it("왕복하고, 형식은 v1.iv.tag.cipher(base64url)이며 매번 iv가 다르다", () => {
    const a = encryptSecret("0.AXoA-refresh-token-값", key);
    const b = encryptSecret("0.AXoA-refresh-token-값", key);
    expect(a).not.toBe(b);
    const parts = a.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
    expect(Buffer.from(parts[1], "base64url")).toHaveLength(12);
    expect(Buffer.from(parts[2], "base64url")).toHaveLength(16);
    expect(a).not.toMatch(/[+/=]/);
    expect(decryptSecret(a, key)).toBe("0.AXoA-refresh-token-값");
    expect(decryptSecret(b, key)).toBe("0.AXoA-refresh-token-값");
  });
  it("다른 키·변조된 태그·변조된 본문·잘못된 형식은 '토큰 복호화 실패'", () => {
    const tok = encryptSecret("secret", key);
    expect(() => decryptSecret(tok, other)).toThrow("토큰 복호화 실패");
    const [v, iv, tag, enc] = tok.split(".");
    const flip = (s: string) => Buffer.from(s, "base64url").map((b, i) => (i === 0 ? b ^ 0xff : b));
    expect(() => decryptSecret([v, iv, Buffer.from(flip(tag)).toString("base64url"), enc].join("."), key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret([v, iv, tag, Buffer.from(flip(enc)).toString("base64url")].join("."), key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret("v2.a.b.c", key)).toThrow("토큰 복호화 실패");
    expect(() => decryptSecret("garbage", key)).toThrow("토큰 복호화 실패");
  });
});

describe("signState/verifyState", () => {
  const now = 1_800_000_000_000; // ms
  const payload = { u: "user-1", n: newNonce(), r: "/rfp/abc", e: Math.floor(now / 1000) + STATE_TTL_S };
  it("서명 왕복 — payload를 그대로 돌려주고 URL 안전 문자만 쓴다", () => {
    const tok = signState(payload, key);
    expect(tok).not.toMatch(/[+/=]/);
    expect(tok.split(".")).toHaveLength(2);
    expect(verifyState(tok, key, now)).toEqual(payload);
    expect(STATE_TTL_S).toBe(600);
  });
  it("만기가 지나면 null", () => {
    const tok = signState(payload, key);
    expect(verifyState(tok, key, payload.e * 1000)).toBeNull();
    expect(verifyState(tok, key, payload.e * 1000 - 1)).toEqual(payload);
  });
  it("변조·다른 키·형식 오류는 null", () => {
    const tok = signState(payload, key);
    const [body, sig] = tok.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...payload, u: "user-2" })).toString("base64url");
    expect(verifyState(`${tampered}.${sig}`, key, now)).toBeNull();
    expect(verifyState(tok, other, now)).toBeNull();
    expect(verifyState(body, key, now)).toBeNull();
    expect(verifyState(`${body}.${sig}.x`, key, now)).toBeNull();
    expect(verifyState("", key, now)).toBeNull();
  });
  it("필드 타입이 어긋난 payload는 서명이 맞아도 null", () => {
    const bad = signState({ u: "user-1", n: "n", r: "/settings", e: "soon" as unknown as number }, key);
    expect(verifyState(bad, key, now)).toBeNull();
  });
  it("newNonce는 16바이트 base64url(22자)이고 매번 다르다", () => {
    const a = newNonce();
    expect(a).toHaveLength(22);
    expect(a).not.toBe(newNonce());
  });
});
