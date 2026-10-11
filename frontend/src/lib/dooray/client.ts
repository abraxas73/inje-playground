import { z } from "zod";

export class DoorayError extends Error {
  constructor(message: string, public status = 502, public code = "upstream") { super(message); }
}

const envelope = z.object({ header: z.object({ isSuccessful: z.boolean() }), result: z.unknown(), cursor: z.string().nullable().optional() });
export type DoorayRequest = (path: string, body?: Record<string, string>) => Promise<z.infer<typeof envelope>>;

/** Only fixed service paths are accepted; credentials never follow redirects. */
export function doorayRequest(token: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): DoorayRequest {
  return async (path, body) => {
    if (!/^\/(common|calendar|messenger)\/v1\//.test(path) || path.includes("..") || path.includes("\\")) throw new DoorayError("잘못된 요청입니다.", 400, "input");
    let res: Response;
    try {
      res = await fetchImpl(`https://api.dooray.com${path}`, { method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}), headers: { Authorization: `dooray-api ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, redirect: "error", cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
    } catch { throw new DoorayError(body ? "전송 결과를 확인하지 못했습니다. 중복 전송을 피하려면 Dooray에서 확인한 뒤 다시 시도해 주세요." : "Dooray에 연결하지 못했습니다. 잠시 후 다시 시도하세요.", 502, body ? "delivery_unknown" : "network"); }
    if (res.status === 401) throw new DoorayError("Dooray 계정을 다시 연결해 주세요.", 409, "reconnect");
    if (!res.ok) {
      const failure = await res.clone().json().catch(() => null);
      const code = failure?.header?.resultCode;
      console.warn("Dooray upstream failure", { endpoint: path.split("?")[0], status: res.status, ...(typeof code === "number" ? { resultCode: code } : {}) });
    }
    if (res.status === 403) throw new DoorayError("Dooray 접근 권한 또는 회사 IP 정책을 확인해 주세요.", 403, "forbidden");
    if (res.status === 404) throw new DoorayError("Dooray에서 요청한 조회 경로를 찾지 못했습니다.", 502, "not_found");
    if (res.status === 429) throw new DoorayError("Dooray 요청이 많습니다. 잠시 후 다시 시도하세요.", 429, "rate_limit");
    if (!res.ok) throw new DoorayError("Dooray 조회에 실패했습니다.");
    let raw: unknown;
    try { raw = await res.json(); } catch { throw new DoorayError("Dooray 응답을 해석하지 못했습니다."); }
    const parsed = envelope.safeParse(raw);
    if (!parsed.success || !parsed.data.header.isSuccessful) throw new DoorayError("Dooray 조회에 실패했습니다.");
    return parsed.data;
  };
}

export const memberSchema = z.object({ id: z.string().min(1), name: z.string(), externalEmailAddress: z.string().email(), defaultOrganization: z.object({ id: z.string().min(1) }) });
export function verifyMember(raw: unknown, organizationId: string) {
  const member = memberSchema.safeParse(raw);
  if (!member.success || member.data.defaultOrganization.id !== organizationId) {
    throw new DoorayError("회사 Dooray 조직에 속한 계정인지 확인해 주세요.", 400, "account_mismatch");
  }
  return member.data;
}

const eventSchema = z.object({ id: z.string(), calendar: z.object({ id: z.string() }), subject: z.string(), startedAt: z.string(), endedAt: z.string(), wholeDayFlag: z.boolean() });
const mailSchema = z.object({ id: z.string(), subject: z.string(), sentAt: z.string(), body: z.object({ mimeType: z.string(), content: z.string() }).nullish(), users: z.object({ from: z.object({ emailUser: z.object({ name: z.string().optional(), emailAddress: z.string().optional() }) }) }) });
const channelSchema = z.object({ id: z.string(), title: z.string(), status: z.string().optional(), displayed: z.boolean().optional() });

export function dayRange(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new DoorayError("날짜가 올바르지 않습니다.", 400, "input");
  const start = new Date(`${day}T00:00:00+09:00`);
  if (!Number.isFinite(start.getTime()) || new Date(start.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== day) throw new DoorayError("날짜가 올바르지 않습니다.", 400, "input");
  return { timeMin: start.toISOString(), timeMax: new Date(start.getTime() + 86400000).toISOString() };
}

export async function events(request: DoorayRequest, day: string, calendarId?: string) {
  const range = dayRange(day);
  const rawCalendars = await request("/calendar/v1/calendars");
  const parsedCalendars = z.array(z.object({ id: z.string().regex(/^\d+$/), name: z.string(), type: z.string() })).safeParse(rawCalendars.result);
  if (!parsedCalendars.success) throw new DoorayError("캘린더 목록을 해석하지 못했습니다.");
  // Dooray's public events API excludes subscription calendars.
  const calendars = parsedCalendars.data.filter(c => c.type !== "subscription").map(c => ({ id: c.id, name: c.name }));
  if (calendarId && !calendars.some(c => c.id === calendarId)) throw new DoorayError("조회할 수 없는 캘린더입니다.", 400, "input");
  if (!calendars.length) return { items: [], calendars };
  try {
    const query = new URLSearchParams({ ...range, calendars: calendarId || calendars.map(c => c.id).join(",") });
    const raw = await request(`/calendar/v1/calendars/*/events?${query}`);
    const parsed = z.array(eventSchema).safeParse(raw.result);
    if (!parsed.success) throw new DoorayError("일정 응답을 해석하지 못했습니다.");
    return { calendars, items: parsed.data.map(e => ({ id: e.id, calendarId: e.calendar.id, subject: e.subject, startedAt: e.startedAt, endedAt: e.endedAt, wholeDayFlag: e.wholeDayFlag })) };
  } catch (e) {
    return { calendars, items: [], error: e instanceof DoorayError ? e.message : "일정을 조회하지 못했습니다. 다시 시도해 주세요." };
  }
}

export async function mailActivity(request: DoorayRequest, includePreview = false) {
  const items: { id: string; subject: string; from: string; sentAt: string; preview?: string }[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  // Bound the activity scan, not the mailbox; a short page does not mean end of feed.
  for (let page = 0; page < 3; page++) {
    const raw = await request(`/common/v1/streams?${new URLSearchParams({ size: "100", ...(cursor ? { before: cursor } : {}) })}`);
    const rows = z.array(z.object({ type: z.string(), mail: z.unknown().optional() })).safeParse(raw.result);
    if (!rows.success) throw new DoorayError("메일 소식을 해석하지 못했습니다.");
    if (!rows.data.length) return { items, partial: false };
    for (const row of rows.data) {
      if (row.type !== "mail") continue;
      const m = mailSchema.safeParse(row.mail);
      if (!m.success) throw new DoorayError("메일 소식을 해석하지 못했습니다.");
      if (ids.has(m.data.id)) continue;
      ids.add(m.data.id);
      items.push({ id: m.data.id, subject: m.data.subject, from: m.data.users.from.emailUser.name || m.data.users.from.emailUser.emailAddress || "", sentAt: m.data.sentAt, ...(includePreview && m.data.body?.mimeType === "text/plain" ? { preview: m.data.body.content.slice(0, 200) } : {}) });
      if (items.length === 20) return { items, partial: true };
    }
    if (!raw.cursor || cursors.has(raw.cursor)) return { items, partial: true };
    cursor = raw.cursor; cursors.add(cursor);
  }
  return { items, partial: true };
}

export async function channels(request: DoorayRequest) {
  const raw = await request("/messenger/v1/channels");
  const parsed = z.array(channelSchema).safeParse(raw.result);
  if (!parsed.success) throw new DoorayError("대화방 응답을 해석하지 못했습니다.");
  return parsed.data.filter(c => c.displayed !== false && (!c.status || c.status === "normal")).map(c => ({ id: c.id, title: c.title || "이름 없는 대화방" }));
}

export async function overview(request: DoorayRequest, day: string, briefing: boolean, calendarId?: string, includeEvents = true) {
  dayRange(day);
  const [e, m, c] = await Promise.allSettled([includeEvents ? events(request, day, calendarId) : Promise.resolve({ items: [] }), briefing ? Promise.resolve({ items: [] }) : mailActivity(request, true), briefing ? Promise.resolve([]) : channels(request)]);
  const error = (reason: unknown) => reason instanceof DoorayError ? reason.message : "조회하지 못했습니다. 다시 시도해 주세요.";
  return {
    events: e.status === "fulfilled" ? e.value : { items: [], error: error(e.reason) },
    mail: m.status === "fulfilled" ? m.value : { items: [], error: error(m.reason) },
    channels: c.status === "fulfilled" ? { items: c.value } : { items: [], error: error(c.reason) },
  };
}
