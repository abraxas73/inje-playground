/**
 * Microsoft 연결용 비밀 보호(스펙 §3.2).
 * - refresh 토큰: AES-256-GCM, 형식 v1.{iv}.{tag}.{cipher}(각 base64url, iv 12B, tag 16B)
 * - OAuth state: HMAC-SHA256 서명 base64url(json).base64url(hmac), 만기(e, epoch 초) 포함
 * 키는 env MS_TOKEN_ENC_KEY(64자 hex). HMAC 키는 sha256("state:" + hex)로 파생한다.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ENC_KEY_ENV = "MS_TOKEN_ENC_KEY";
/** state 만기(초) — connect 라우트가 e = now + STATE_TTL_S 로 만든다 */
export const STATE_TTL_S = 600;

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const DECRYPT_FAIL = "토큰 복호화 실패";

/** env의 64자 hex → 32바이트 키. 없거나 형식이 다르면 null(호출자가 설정 누락으로 처리). */
export function parseEncKey(hex: string | undefined): Buffer | null {
  const s = (hex ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(s)) return null;
  return Buffer.from(s, "hex");
}

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, b64u(iv), b64u(cipher.getAuthTag()), b64u(enc)].join(".");
}

export function decryptSecret(token: string, key: Buffer): string {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error(DECRYPT_FAIL);
  try {
    const iv = unb64u(parts[1]);
    const tag = unb64u(parts[2]);
    const enc = unb64u(parts[3]);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error(DECRYPT_FAIL);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  } catch {
    throw new Error(DECRYPT_FAIL);
  }
}

/** OAuth state 본문: u 세션 사용자 id, n 난수, r returnTo 경로, e 만기(epoch 초) */
export interface StatePayload {
  u: string;
  n: string;
  r: string;
  e: number;
}

function stateKey(key: Buffer): Buffer {
  return createHash("sha256").update(`state:${key.toString("hex")}`).digest();
}

function hmac(body: string, key: Buffer): Buffer {
  return createHmac("sha256", stateKey(key)).update(body).digest();
}

export function signState(payload: StatePayload, key: Buffer): string {
  const body = b64u(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${body}.${b64u(hmac(body, key))}`;
}

/** 서명·형식·만기를 검사해 payload를 돌려준다. 어느 하나라도 어긋나면 null. 사용자 일치(u)는 라우트가 확인한다. */
export function verifyState(token: string, key: Buffer, nowMs: number = Date.now()): StatePayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || token.indexOf(".", dot + 1) !== -1) return null;
  const body = token.slice(0, dot);
  const sig = unb64u(token.slice(dot + 1));
  const expected = hmac(body, key);
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(unb64u(body).toString("utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { u, n, r, e } = parsed as Record<string, unknown>;
  if (typeof u !== "string" || typeof n !== "string" || typeof r !== "string" || typeof e !== "number") return null;
  if (e * 1000 <= nowMs) return null;
  return { u, n, r, e };
}

/** 16바이트 난수 base64url(22자) */
export function newNonce(): string {
  return b64u(randomBytes(16));
}
