// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const m = vi.hoisted(() => ({ authorized: true, load: vi.fn(), validate: vi.fn(), upsert: vi.fn(), remove: vi.fn(), eq: vi.fn(), from: vi.fn(), client: vi.fn(), issues: vi.fn(), update: vi.fn(), user: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.authorized ? { ok: true, userId: 'session-user', admin: { from: m.from, auth: { admin: { getUserById: m.user } } } } : { ok: false, response: NextResponse.json({}, { status: 401 }) } }));
vi.mock("@/lib/jira/client", async orig => ({ ...await orig<typeof import('@/lib/jira/client')>(), loadConnection: m.load, connectionClient: () => m.client }));
vi.mock("@/lib/jira/issues", async orig => ({ ...await orig<typeof import('@/lib/jira/issues')>(), myIssues: m.issues, updateIssue: m.update }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { GET, POST, DELETE } from '@/app/api/jira/connection/route';
import { GET as list } from '@/app/api/jira/issues/route';
import { POST as update } from '@/app/api/jira/issues/[key]/route';
const req = (body: unknown, path = '/api/jira/connection') => new NextRequest('https://app.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.clearAllMocks(); m.authorized = true;
  vi.stubEnv('MS_TOKEN_ENC_KEY', '01'.repeat(32)); vi.stubEnv('JIRA_CLIENT_ID','client'); vi.stubEnv('JIRA_CLIENT_SECRET','secret');
  m.user.mockResolvedValue({ data: { user: { email: 'me@innogrid.com' } } });
  m.load.mockResolvedValue(null);
  m.validate.mockResolvedValue({ account_id: 'jira-me', account_name: '홍길동', email: 'me@innogrid.com', api_base: 'https://pms-innogrid.atlassian.net' });
  m.upsert.mockResolvedValue({ error: null }); m.eq.mockResolvedValue({ error: null }); m.remove.mockReturnValue({ eq: m.eq }); m.from.mockReturnValue({ upsert: m.upsert, delete: m.remove });
});
it('미인증은 모든 Jira 엔드포인트에서 차단', async () => {
  m.authorized = false;
  for (const response of [await GET(), await POST(), await DELETE(req({})), await list(new NextRequest('https://app.test/api/jira/issues')), await update(req({}), { params: Promise.resolve({ key: 'AX-1' }) })]) expect(response.status).toBe(401);
  expect(m.load).not.toHaveBeenCalled(); expect(m.validate).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it('연결 조회는 비밀을 반환하지 않고 세션 사용자 범위만 조회', async () => {
  m.load.mockResolvedValue({ auth_type: 'oauth', account_name: '홍길동', token_enc: 'encrypted-secret', email: 'me@innogrid.com', account_id: 'id', api_base: 'base', connected_at: 'today' });
  const response = await GET(); const body = await response.json();
  expect(body).toEqual({ connected: true, configured: true, needsReconnect: false, site: 'https://pms-innogrid.atlassian.net', email: 'me@innogrid.com', confluence: { enabled: false, granted: false, canWrite: false }, accountName: '홍길동', connectedAt: 'today' });
  expect(m.load.mock.calls[0][1]).toBe('session-user');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('개인 토큰 등록 엔드포인트는 폐기하여 저장하지 않는다', async () => {
  expect((await POST()).status).toBe(410);
  expect(m.upsert).not.toHaveBeenCalled();
});
it('연결 해제도 세션 사용자만 삭제', async () => {
  expect((await DELETE(req({ user_id: 'other' }))).status).toBe(200);
  expect(m.eq).toHaveBeenCalledWith('user_id', 'session-user');
});
it('미연결과 잘못된 목록 조건을 구분', async () => {
  expect(await (await list(new NextRequest('https://app.test/api/jira/issues?scope=progress'))).json()).toEqual({ connected: false, items: [], nextPageToken: null });
  expect((await list(new NextRequest('https://app.test/api/jira/issues?scope=inject'))).status).toBe(400);
  expect(m.issues).not.toHaveBeenCalled();
});
