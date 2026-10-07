// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { connectionClient, jiraRequest, sealToken, validateToken, JIRA_SITE } from "@/lib/jira/client";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('API 토큰은 암호화하여 보관하고 고정 회사 Jira에만 전송한다', async () => {
  vi.stubEnv('MS_TOKEN_ENC_KEY', '01'.repeat(32));
  const encrypted = sealToken('personal-token');
  expect(encrypted).not.toContain('personal-token');
  const fetch = vi.fn().mockResolvedValue(new Response('{"ok":true}'));
  vi.stubGlobal('fetch', fetch);
  await connectionClient({ account_id: 'me', account_name: '홍길동', email: 'me@innogrid.com', api_base: JIRA_SITE, token_enc: encrypted, connected_at: '' })('/rest/api/3/myself');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Basic ' + Buffer.from('me@innogrid.com:personal-token').toString('base64'));
  await expect(jiraRequest('https://evil.test', 'me', 'token', '/rest/api/3/myself')).rejects.toMatchObject({ status: 500 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('다른 이메일·비활성 계정은 연결하지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ accountId: 'other', active: true, emailAddress: 'other@innogrid.com' }))));
  await expect(validateToken('me@innogrid.com', 't')).rejects.toMatchObject({ status: 400 });
});
it('범위 지정 토큰은 회사 cloud ID를 검증한 후 게이트웨이에서 본인 확인', async () => {
  const cloudId = '11111111-1111-1111-1111-111111111111';
  const fetch = vi.fn().mockResolvedValueOnce(new Response('', { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ cloudId }))).mockResolvedValueOnce(new Response(JSON.stringify({ accountId: 'me', active: true, emailAddress: 'me@innogrid.com', displayName: '홍길동' })));
  vi.stubGlobal('fetch', fetch);
  expect(await validateToken('me@innogrid.com', 't')).toMatchObject({ account_id: 'me', api_base: `https://api.atlassian.com/ex/jira/${cloudId}` });
  expect(fetch.mock.calls[1][0]).toBe(JIRA_SITE + '/_edge/tenant_info');
});
it('Jira 오류 본문이나 토큰을 사용자 오류에 노출하지 않고 변경 요청을 자동 재시도하지 않는다', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('sensitive upstream data', { status: 403 }));
  vi.stubGlobal('fetch', fetch);
  await expect(jiraRequest(JIRA_SITE, 'me', 't', '/rest/api/3/myself')).rejects.toMatchObject({ message: 'Jira 권한 또는 API 토큰 범위를 확인하세요.' });
  fetch.mockClear().mockRejectedValue(new Error('private network detail'));
  await expect(jiraRequest(JIRA_SITE, 'me', 't', '/rest/api/3/issue/AX-1/comment', { method: 'POST' })).rejects.toThrow('실제 반영 여부');
  expect(fetch).toHaveBeenCalledTimes(1);
});
