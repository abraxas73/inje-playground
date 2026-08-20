import type { DirectRecipient } from "./types";

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * 점심 결정 요청 본문에서 DM 수신자 목록을 뽑는다.
 * - `recipients`(신규: Teams는 email, Dooray는 memberId) 우선
 * - 없으면 `member_ids`(기존 Dooray 전용) → {memberId}
 */
export function parseRecipients(body: unknown): DirectRecipient[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { recipients?: unknown; member_ids?: unknown };

  if (Array.isArray(b.recipients) && b.recipients.length > 0) {
    return b.recipients
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({ email: str(r.email), name: str(r.name), memberId: str(r.memberId) }));
  }

  if (Array.isArray(b.member_ids)) {
    return b.member_ids.filter((id): id is string => typeof id === "string").map((id) => ({ memberId: id }));
  }

  return [];
}
