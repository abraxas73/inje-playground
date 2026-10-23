import { kstDay } from "@/lib/chat/usage";

/** 웹 결재·일정(읽기 전용) — 데스크톱 앱의 기존 MCP 도구 결과(pending_approvals·list_events, mobile/lib/mcp/mcp_tools.dart)를 화면용으로 정리한다. */
export type Approval = { docId: string; formId: string; title: string; form: string; drafter: string; dept: string; arrived: string; waitingDays: number | null; status: string; unread: boolean; fileCount: number; url: string };
export type GwEvent = { schSeq: string; title: string; start: string; end: string; allday: boolean; calendar: string; mine: boolean; attendees: string };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ID_RE = /^\d{1,20}$/;
export const GW_ORIGIN = "https://gw.innogrid.com";

/** 아마란스 웹에서 결재 문서를 여는 주소(앱 approvals_screen.dart approvalWebUrl과 같다). */
export const approvalWebUrl = (docId: string, formId: string) =>
  `${GW_ORIGIN}/#/popup?docID=${encodeURIComponent(docId)}&formId=${encodeURIComponent(formId)}&docAuth=0&MicroModuleCode=eap&callComp=UBAP002`;

/** 숫자만 남긴 날짜·시각(예 20261020153012) → "2026-10-20 15:30". */
function stamp(s: string): string {
  const d = s.replace(/\D/g, "");
  if (d.length < 8) return s;
  const day = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  return d.length >= 12 ? `${day} ${d.slice(8, 10)}:${d.slice(10, 12)}` : day;
}

/** pending_approvals 결과(`items`, `totalCount`) → 미결 목록. docId·formId가 숫자가 아니면 버린다(링크 주소에 들어가므로). */
export function parseApprovals(raw: unknown): { total: number; items: Approval[] } {
  const o = rec(raw);
  const items = (Array.isArray(o.items) ? o.items : []).map(rec).filter((r) => ID_RE.test(str(r.docId)) && ID_RE.test(str(r.formId))).map((r) => {
    const docId = str(r.docId), formId = str(r.formId), w = r.waitingDays;
    return {
      docId, formId, title: str(r.title), form: str(r.form), drafter: str(r.drafter), dept: str(r.dept), arrived: stamp(str(r.arrivedDt)),
      waitingDays: typeof w === "number" && Number.isFinite(w) ? w : null, status: str(r.status), unread: r.unread === true, fileCount: Number(r.fileCount ?? 0) || 0, url: approvalWebUrl(docId, formId),
    };
  });
  return { total: Math.max(items.length, Number(o.totalCount ?? 0) || 0), items };
}

/** list_events 결과(`events`) → 일정 목록(종일 먼저, 시작 시각 순). */
export function parseEvents(raw: unknown): GwEvent[] {
  const o = rec(raw);
  return (Array.isArray(o.events) ? o.events : []).map(rec).map((e) => ({
    schSeq: str(e.schSeq), title: str(e.title), start: str(e.start), end: str(e.end), allday: e.allday === true, calendar: str(e.calendar).replace(/\(\d+\)$/, ""), mine: e.mine === true, attendees: str(e.attendees),
  })).sort((a, b) => Number(b.allday) - Number(a.allday) || a.start.localeCompare(b.start));
}

/** 조회 날짜 검사 — 오늘(KST) ±7일 안의 YYYY-MM-DD만. 비면 오늘. 벗어나면 null. */
export function scheduleDate(q: string | null, now = new Date()): string | null {
  const today = kstDay(now);
  if (!q) return today;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(q) ? Date.parse(`${q}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== q) return null; // 2026-02-30 같은 날은 거절
  const diff = (t - Date.parse(`${today}T00:00:00Z`)) / 86_400_000;
  return Math.abs(diff) <= 7 ? q : null;
}
