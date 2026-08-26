import { timingSafeEqual } from "node:crypto";

/** `Authorization: Bearer <token>`을 상수시간 비교. 서버 토큰이 없거나 너무 짧으면 무조건 거부. */
export function verifyIngestToken(authorization: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 8) return false;
  if (!authorization) return false;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!m) return false;
  const given = Buffer.from(m[1].trim(), "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}
