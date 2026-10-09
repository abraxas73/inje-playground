// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connectionClient, jiraRequest, sealToken, type JiraConnection } from "@/lib/jira/client";
import { authorizeUrl, companyResource, companyResourceInfo, exchangeCode } from "@/lib/jira/oauth";
const base = 'https://api.atlassian.com/ex/jira/11111111-1111-1111-1111-111111111111';
const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/lib/jira/oauth', async orig => ({ ...await orig<typeof import('@/lib/jira/oauth')>(), refreshToken: m.refresh }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
beforeEach(() => { vi.stubEnv('MS_TOKEN_ENC_KEY', '01'.repeat(32)); vi.stubEnv('JIRA_CLIENT_ID', 'client'); vi.stubEnv('JIRA_CLIENT_SECRET', 'secret'); vi.clearAllMocks(); });
function connection(): JiraConnection { return { account_id: 'me', account_name: '홍길동', email: 'me@innogrid.com', api_base: base, token_enc: sealToken('access'), refresh_token_enc: sealToken('refresh'), auth_type: 'oauth', expires_at: new Date(Date.now() + 3600000).toISOString(), connected_at: 'today' }; }
function db(results: unknown[]) {
  const q = { delete: vi.fn(), update: vi.fn(), eq: vi.fn(), or: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() };
  for (const k of ['delete', 'update', 'eq', 'or', 'select'] as const) q[k].mockReturnValue(q);
  for (const result of results) q.maybeSingle.mockResolvedValueOnce(result);
  return { q, admin: { from: () => q } as unknown as SupabaseClient };
}
it('OAuth 로그인 URL은 offline_access와 고정 콜백·사용자 state를 포함한다', () => {
  const url = new URL(authorizeUrl('signed-state'));
  expect(url.origin).toBe('https://auth.atlassian.com');
  expect(url.searchParams.get('scope')).toBe('read:jira-user read:jira-work write:jira-work report:personal-data offline_access');
  expect(url.searchParams.get('state')).toBe('signed-state');
  expect(url.searchParams.get('redirect_uri')).toBe('https://inje-playground.vercel.app/api/jira/callback');
  expect(url.toString()).not.toContain('secret');
});
it('CONFLUENCE_ENABLED=true면 같은 로그인에 Confluence 권한도 요청한다', () => {
  vi.stubEnv('CONFLUENCE_ENABLED', 'true');
  const scope = new URL(authorizeUrl('s')).searchParams.get('scope')!.split(' ');
  expect(scope).toEqual(expect.arrayContaining(['read:jira-work', 'offline_access', 'read:confluence-content.all', 'search:confluence', 'write:confluence-content']));
});
it('사이트 정보에 실제로 받은 권한(같은 사이트 항목 합집합)을 함께 돌려준다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json([
    { id: '11111111-1111-1111-1111-111111111111', url: 'https://pms-innogrid.atlassian.net', scopes: ['read:jira-user','read:jira-work','write:jira-work'] },
    { id: '11111111-1111-1111-1111-111111111111', url: 'https://pms-innogrid.atlassian.net/', scopes: ['search:confluence','read:confluence-content.all'] },
    { id: '22222222-2222-2222-2222-222222222222', url: 'https://other.atlassian.net', scopes: ['write:confluence-content'] },
  ])));
  const info = await companyResourceInfo('access');
  expect(info.base).toBe(base);
  expect(info.scopes.sort()).toEqual(['read:confluence-content.all','read:jira-user','read:jira-work','search:confluence','write:jira-work']);
});
it('회사 사이트와 모든 동의 범위를 확인한다. 다른 사이트만 있으면 거부', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json([{ id: '11111111-1111-1111-1111-111111111111', url: 'https://pms-innogrid.atlassian.net', scopes: ['read:jira-user','read:jira-work','write:jira-work'] }])).mockResolvedValueOnce(Response.json([{ url: 'https://other.atlassian.net' }]));
  vi.stubGlobal('fetch',fetch); expect(await companyResource('access')).toBe(base);
  await expect(companyResource('access')).rejects.toMatchObject({status:403});
});
it('코드 교환 실패의 원문·시크릿을 노출하지 않는다', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ error:'invalid_grant', error_description:'sensitive' },{status:400})));
  await expect(exchangeCode('code')).rejects.toMatchObject({status:409,code:'reconnect'});
});
it('유효한 암호화 액세스 토큰은 Bearer로 고정 게이트웨이에만 전송', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ok:true})); vi.stubGlobal('fetch',fetch);
  const {admin}=db([]); const c=connection(); expect(c.token_enc).not.toContain('access');
  await (await connectionClient(c,admin,'u'))('/rest/api/3/myself');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer access');
  await expect(jiraRequest('https://evil.test','t','/rest/api/3/myself')).rejects.toMatchObject({status:500});
  expect(fetch).toHaveBeenCalledTimes(1); expect(m.refresh).not.toHaveBeenCalled();
});
it('개인 토큰 연결은 사용하지 않고 OAuth 재연결을 요청', async () => {
  const {admin}=db([]); await expect(connectionClient({...connection(),auth_type:'api_token'},admin,'u')).rejects.toMatchObject({code:'reconnect'});
});
it('만료된 토큰은 DB 잠금 후 회전하고 두 토큰을 암호화해 저장', async () => {
  const {admin,q}=db([{data:{user_id:'u'}},{data:{user_id:'u'}}]);
  m.refresh.mockResolvedValue({accessToken:'new-access',refreshToken:'new-refresh',expiresIn:3600});
  const fetch=vi.fn().mockResolvedValue(Response.json({}));vi.stubGlobal('fetch',fetch);
  await (await connectionClient({...connection(),expires_at:'2000-01-01'},admin,'u'))('/rest/api/3/myself');
  expect(m.refresh).toHaveBeenCalledWith('refresh');
  expect(JSON.stringify(q.update.mock.calls)).not.toContain('new-refresh');
  expect(q.eq).toHaveBeenCalledWith('connected_at','today');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer new-access');
});
it('동시 갱신 중에는 추가 refresh를 보내지 않는다', async () => {
  const stale={...connection(),expires_at:'2000-01-01'};
  const {admin}=db([{data:null},{data:stale}]);
  await expect(connectionClient(stale,admin,'u')).rejects.toMatchObject({status:503}); expect(m.refresh).not.toHaveBeenCalled();
});
it('갱신 중 연결 해제·재연결이 발생하면 저장 실패로 중단한다', async () => {
  const {admin}=db([{data:{user_id:'u'}},{data:null}]);
  m.refresh.mockResolvedValue({accessToken:'new-access',refreshToken:'new-refresh',expiresIn:3600});
  await expect(connectionClient({...connection(),expires_at:'2000-01-01'},admin,'u')).rejects.toMatchObject({code:'reconnect'});
});
it('변경 요청은 자동 재시도하지 않는다', async () => {
  const fetch=vi.fn().mockRejectedValue(new Error('private'));vi.stubGlobal('fetch',fetch);
  await expect(jiraRequest(base,'t','/rest/api/3/issue/AX-1/comment',{method:'POST'})).rejects.toThrow('실제 반영 여부'); expect(fetch).toHaveBeenCalledTimes(1);
});
