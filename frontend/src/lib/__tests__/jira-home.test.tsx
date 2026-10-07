import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
it.each([
  {connected:false,items:[]},
  {connected:true,items:[]},
  {connected:true,items:[{key:'AX-3', summary:'완료', status:'Done', category:'done'}]},
])('표시할 업무가 없으면 홈 카드 전체를 숨긴다: %j', async data => {
  const fetch = vi.fn().mockImplementation(async () => Response.json(data));
  vi.stubGlobal('fetch', fetch);
  const view = render(<JiraWorkCard />);
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
  view.unmount(); user.allowed=false;
  render(<JiraWorkCard />);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('새로고침 후 마지막 업무가 완료되면 카드가 사라진다', async () => {
  const fetch = vi.fn()
    .mockImplementationOnce(async () => Response.json({connected:true,items:[{key:'AX-1',summary:'할 일',status:'To Do',category:'new'}]}))
    .mockImplementation(async () => Response.json({connected:true,items:[]}));
  vi.stubGlobal('fetch', fetch);
  const view = render(<JiraWorkCard />);
  await screen.findByText('할 일');
  fireEvent.click(screen.getByRole('button',{name:'새로고침'}));
  await act(async () => {});
  expect(view.container).toBeEmptyDOMElement();
});
