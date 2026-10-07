import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import JiraAccountCard from '@/components/settings/JiraAccountCard';
afterEach(() => vi.unstubAllGlobals());
it('설정에서는 토큰 입력 없이 Atlassian 로그인 링크를 제공', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({connected:false,configured:true,email:'me@innogrid.com'})));
  render(<JiraAccountCard />);
  expect(await screen.findByRole('link',{name:'연결'})).toHaveAttribute('href','/api/jira/connect');
  expect(screen.queryByLabelText('개인 API 토큰')).toBeNull();
});
it('회사 OAuth 설정이 없으면 준비 안내를 보여주고 로그인 링크를 숨긴다', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({connected:false,configured:false,email:'me@innogrid.com'})));
  render(<JiraAccountCard />);
  await screen.findByText(/회사 Jira 로그인 설정을 준비 중/);
  expect(screen.queryByRole('link',{name:'연결'})).toBeNull();
});
it('기존 개인 토큰 연결은 한 번 로그인으로 전환하도록 안내한다', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({connected:false,configured:true,needsReconnect:true,email:'me@innogrid.com'})));
  render(<JiraAccountCard />);
  await screen.findByText(/연결 방식이 Atlassian 로그인으로 변경/);
  expect(screen.queryByText('연결됨')).toBeNull();
});
