/**
 * 사용자가 직접 넣는 알림 웹훅 URL 검사(개인 워크플로우 URL).
 *
 * 서버가 이 주소로 우리 알림 본문을 POST하므로, 사내망·메타데이터 주소를 넣어 서버를 탐색기로
 * 쓰는 걸 막는다(SSRF). 호스트 종류만 제한하고 도메인은 열어 둔다 — Power Automate 트리거 URL의
 * 호스트가 지역·테넌트마다 다르기 때문이다.
 */
const PRIVATE_HOST_RE = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./, // 링크로컬(클라우드 메타데이터 169.254.169.254 포함)
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i, // IPv6 유니크 로컬
];

export const WEBHOOK_URL_MAX = 2000;

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/** https + 공개 호스트만 통과. 빈 값은 호출 쪽에서 "해제"로 다루므로 여기서는 오류. */
export function checkWebhookUrl(raw: unknown): UrlCheck {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return { ok: false, error: "URL을 입력하세요." };
  if (value.length > WEBHOOK_URL_MAX) return { ok: false, error: `URL이 너무 깁니다(${WEBHOOK_URL_MAX}자 이하).` };
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, error: "올바른 URL이 아닙니다." };
  }
  if (u.protocol !== "https:") return { ok: false, error: "https 주소만 쓸 수 있습니다." };
  if (u.username || u.password) return { ok: false, error: "URL에 계정 정보를 넣을 수 없습니다." };
  if (PRIVATE_HOST_RE.some((re) => re.test(u.hostname))) {
    return { ok: false, error: "사내망·로컬 주소는 쓸 수 없습니다. 외부에서 접근되는 워크플로우 URL을 넣어 주세요." };
  }
  return { ok: true, url: value };
}
