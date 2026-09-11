export interface Digest { subject: string; html: string; text: string }
export interface DigestNotice { title: string; summary: string; source_url: string; published_at: string }
const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const format = (date: string) => new Date(date).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
export function buildDigest(notices: DigestNotice[], total: number, asOf: string, lastSyncedAt: string | null, appUrl: string, periodFrom?: string): Digest {
  const pageUrl = new URL("/people-news", appUrl).href;
  if (!pageUrl.startsWith("https://")) throw new Error("메일의 앱 주소는 HTTPS여야 합니다.");
  const date = new Date(asOf).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });
  const subject = `[인사·부고] ${date} 새 소식 ${total}건`;
  const intro = total ? `새로 수집된 인사·부고 ${total}건입니다.${total > notices.length ? ` 최신 ${notices.length}건을 표시합니다.` : ""}` : "새로 수집된 인사·부고 소식이 없습니다.";
  const collection = lastSyncedAt ? `마지막 수집: ${format(lastSyncedAt)} (한국 시간)` : "아직 수집이 완료되지 않았습니다.";
  const period = periodFrom ? `포함 범위: ${format(periodFrom)} ~ ${format(asOf)} 사이 새로 수집된 소식 (한국 시간, 기사 송고일과 다를 수 있음)` : "";
  const rows = notices.map((n) => {
    const url = /^https:\/\/www\.yna\.co\.kr\/view\/AKR\d+$/.test(n.source_url) ? n.source_url : pageUrl;
    return { html: `<li style="padding:16px 0;border-bottom:1px solid #e2e8f0"><a href="${escape(url)}" style="color:#0369a1;font-size:16px;font-weight:600">${escape(n.title)}</a><p style="color:#64748b;font-size:12px">${escape(format(n.published_at))}</p><p style="font-size:14px;line-height:1.6">${escape(n.summary)}</p></li>`, text: `${n.title}\n${format(n.published_at)}\n${n.summary}\n${url}` };
  });
  return { subject, html: `<div lang="ko" style="max-width:640px;margin:auto;padding:24px;font-family:Arial,sans-serif;color:#0f172a"><h1 style="font-size:24px">연합뉴스 인사·부고</h1><p>${escape(intro)}</p><p style="font-size:12px;color:#64748b">${escape(period)}</p><p style="font-size:12px;color:#64748b">${escape(collection)}</p><ul style="list-style:none;padding:0">${rows.map((r) => r.html).join("")}</ul><p><a href="${escape(pageUrl)}">전체 소식 보기 · 수신 시간 변경 · 수신 해제</a></p><p style="font-size:12px;color:#64748b">연합뉴스 RSS 제공 소식입니다. 자세한 내용과 정정 사항은 원문을 확인해 주세요. 예약 메일은 하루 한 번, 즉시 수신은 요청할 때 발송합니다.</p></div>`, text: `${subject}\n\n${intro}\n${period}\n${collection}\n\n${rows.map((r) => r.text).join("\n\n")}\n\n전체 소식 보기 · 수신 시간 변경 · 수신 해제: ${pageUrl}\n출처: 연합뉴스 RSS. 자세한 내용은 원문을 확인해 주세요.` };
}
