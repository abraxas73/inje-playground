import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JiraAccountCard from '@/components/settings/JiraAccountCard';
afterEach(() => vi.unstubAllGlobals());
it('미연결에서 개인 토큰을 비밀번호 입력으로 받고 저장 후 화면에서 지운다', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ connected: false, site: 'site', email: 'me@innogrid.com' }))).mockResolvedValueOnce(new Response('{"connected":true}')).mockResolvedValueOnce(new Response(JSON.stringify({ connected: true, site: 'site', email: 'me@innogrid.com', accountName: '홍길동' })));
  vi.stubGlobal('fetch', fetch);
  render(<JiraAccountCard />);
  const input = await screen.findByLabelText('개인 API 토큰');
  expect(input).toHaveAttribute('type', 'password');
  fireEvent.change(input, { target: { value: 'personal-token' } });
  fireEvent.click(screen.getByRole('button', { name: '지라 연결' }));
  await screen.findByText('Jira 계정이 연결되었습니다.');
  await waitFor(() => expect(screen.queryByLabelText('개인 API 토큰')).toBeNull());
  expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{"token":"personal-token"}' });
  expect(screen.getByText('연결됨')).toBeInTheDocument();
});
it('저장 실패는 성공 상태로 바꾸지 않으며 재입력을 위해 토큰을 지운다', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ connected: false, email: 'me@innogrid.com' }))).mockResolvedValueOnce(new Response('{"error":"토큰을 확인하세요"}', { status: 400 })));
  render(<JiraAccountCard />);
  const input = await screen.findByLabelText('개인 API 토큰');
  fireEvent.change(input, { target: { value: 'bad-token' } });
  fireEvent.click(screen.getByRole('button', { name: '지라 연결' }));
  await screen.findByText('토큰을 확인하세요');
  expect(input).toHaveValue('');
  expect(screen.queryByText('연결됨')).toBeNull();
});
