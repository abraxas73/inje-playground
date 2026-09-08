/**
 * 사용자가 직접 넣는 알림 웹훅 URL 검사(개인 워크플로우 URL).
 *
 * 서버가 이 주소로 우리 알림 본문을 POST하므로, 사내망·메타데이터 주소를 넣어 서버를 탐색기로
 * 쓰는 걸 막는다(SSRF). 도메인은 열어 두되(Power Automate 트리거 호스트가 지역·테넌트마다 다르다)
 * **호스트 종류**를 제한한다:
 *   - IP 리터럴(IPv4·IPv6) 전면 금지 — 워크플로우 URL은 항상 도메인 이름이다.
 *     이렇게 하면 `10.0.0.5`·`[::1]`·`[::ffff:127.0.0.1]`·`0x7f.1` 같은 표기 우회가 한 번에 사라진다.
 *   - 점이 없는 단일 라벨 호스트 금지 — `localhost`, 사내 단일 이름(`gw`, `wiki`)을 막는다.
 *   - 사설 접미사 금지 — `.local`, `.internal`, `.localhost`, `.home.arpa`, `.lan`, `.corp`, `.intranet`.
 * 발송 시에는 리다이렉트를 따라가지 않는다(`postJson`의 `redirect: "manual"`) — 허용 호스트가 302로
 * 내부 주소를 가리키는 우회를 막기 위해서다.
 */
const PRIVATE_SUFFIXES = [".local", ".internal", ".localhost", ".home.arpa", ".lan", ".corp", ".intranet"];
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export const WEBHOOK_URL_MAX = 2000;

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

const HOST_ERROR = "사내망·로컬 주소는 쓸 수 없습니다. 외부에서 접근되는 워크플로우 URL(도메인 이름)을 넣어 주세요.";

/** https + 공개 도메인 호스트만 통과. 빈 값은 호출 쪽에서 "해제"로 다루므로 여기서는 오류. */
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

  // 후행 점(`example.com.`)은 DNS에서 같은 이름이라 제거하고 판정한다
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, error: HOST_ERROR };
  // IPv6는 URL.hostname이 대괄호를 유지한다 — 대괄호·콜론이 있으면 IP 리터럴
  if (host.startsWith("[") || host.includes(":") || IPV4_RE.test(host)) return { ok: false, error: HOST_ERROR };
  if (!host.includes(".")) return { ok: false, error: HOST_ERROR };
  if (PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, error: HOST_ERROR };
  return { ok: true, url: value };
}
