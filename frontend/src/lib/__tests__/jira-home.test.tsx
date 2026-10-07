import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import JiraWorkCard from '@/components/home/JiraWorkCard';
const user = vi.hoisted(() => ({ id: 'self', allowed: true }));
vi.mock('@/hooks/useUserRole', () => ({ useUserRole: () => ({ userId: user.id, canAccessPage: () => user.allowed }) }));
afterEach(() => { vi.unstubAllGlobals(); user.id = 'self'; user.allowed = true; });
it('To Do와 진행 중을 보여주고 완료를 제외하며 새로고침으로 다시 조회한다', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ connected: true, items: [] }));
  fetch.mockImplementation(async () => Response.json({ connected: true, items: [
    {key:'AX-1', summary:'할 일', status:'To Do', category:'new'},
    {key:'AX-2', summary:'개발', status:'In Progress', category:'indeterminate'},
    {key:'AX-3', summary:'완료된 일', status:'Done', category:'done'},
  ]}));
  vi.stubGlobal('fetch', fetch);
  render(<JiraWorkCard />);
  expect(await screen.findByText('할 일')).toBeInTheDocument();
  expect(screen.getByText('개발')).toBeInTheDocument();
  expect(screen.queryByText('완료된 일')).toBeNull();
  expect(screen.getByRole('link', {name:/AX-1/})).toHaveAttribute('href','/jira/AX-1');
  expect(fetch.mock.calls[0][0]).toBe('/api/jira/issues?scope=open');
  fireEvent.click(screen.getByRole('button',{name:'새로고침'}));
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
});
it('미연결이면 설정으로 안내하고 권한이 없으면 요청하지 않는다', async () => {
  const fetch = vi.fn().mockImplementation(async () => Response.json({connected:false,items:[]}));
  vi.stubGlobal('fetch',fetch);
  const view = render(<JiraWorkCard />);
  expect(await screen.findByRole('link',{name:'지라 연결'})).toHaveAttribute('href','/settings#jira');
  view.unmount(); user.allowed=false;
  render(<JiraWorkCard />);
  expect(fetch).toHaveBeenCalledTimes(1);
});
