import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AdminUsersPage from '@/app/admin/users/page';
import { installsFromRows, parseAppUa } from '@/lib/desktop/presence';

vi.mock('@/components/admin/users/UserDetailSheet', () => ({ default: () => null }));
afterEach(() => vi.unstubAllGlobals());

const base = { role: 'user', avatar_url: null, updated_at: '2026-10-01T00:00:00Z', settings: {}, directory: null, installs: {} };
const users = [
  { ...base, id: 'p1', user_id: 'u1', email: 'kim@example.com', display_name: '김철수', created_at: '2026-10-01T03:00:00Z', last_login_at: '2026-10-20T00:30:00Z',
    directory: { division: null, headquarters: 'AX본부', team: '플랫폼팀', duty: '팀장', position: null },
    installs: { ios: { version: '1.7.16', build: 67, at: '2026-10-20T00:18:46Z' }, windows: { version: '1.7.15', build: 66, at: '2026-10-19T00:00:00Z' }, linux: { version: '1.8.0', build: 130, at: '2026-10-29T00:00:00Z' } } },
  { ...base, id: 'p2', user_id: 'u2', email: 'park@example.com', display_name: '박영희', role: 'guest', created_at: '2026-09-15T03:00:00Z', last_login_at: null },
];

/** /api/users와 /api/admin/test-accounts(테스트 계정 카드)를 따로 응답 — 호출마다 새 Response */
function stubFetch(list: unknown[], accounts: unknown[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(Response.json(String(url).includes('test-accounts') ? { accounts } : { users: list }))));
}

it('앱 UA를 플랫폼·버전·빌드로 풀고 사용자별·플랫폼별 최신 1건만 남긴다', () => {
  expect(parseAppUa('InnogridApp/1.7.16 (iOS) InnogridBuild/67')).toEqual({ platform: 'ios', version: '1.7.16', build: 67 });
  expect(parseAppUa('Mozilla/5.0 (Macintosh) Chrome/130')).toBeNull();
  const rows = [
    { user_id: 'u1', user_agent: 'InnogridApp/1.7.16 (windows) InnogridBuild/67', logged_in_at: '2026-10-20T00:00:00Z' },
    { user_id: 'u1', user_agent: 'InnogridApp/1.7.14 (windows) InnogridBuild/65', logged_in_at: '2026-10-18T00:00:00Z' },
    { user_id: 'u1', user_agent: 'InnogridApp/1.7.15 (android) InnogridBuild/66', logged_in_at: '2026-10-19T00:00:00Z' },
    { user_id: 'u1', user_agent: 'Mozilla/5.0 (Windows NT 10.0)', logged_in_at: '2026-10-20T01:00:00Z' },
    { user_id: 'u2', user_agent: 'InnogridApp/dev (macOS) InnogridBuild/0', logged_in_at: '2026-10-17T00:00:00Z' },
  ];
  expect(installsFromRows(rows)).toEqual({
    u1: { windows: { version: '1.7.16', build: 67, at: '2026-10-20T00:00:00Z' }, android: { version: '1.7.15', build: 66, at: '2026-10-19T00:00:00Z' } },
    u2: { macos: { version: 'dev', build: 0, at: '2026-10-17T00:00:00Z' } },
  });
});

it('표에 가입일·최근 로그인·설치 버전이 보이고 검색어로 줄인다', async () => {
  stubFetch(users, []);
  render(<AdminUsersPage />);
  const kim = await screen.findByRole('row', { name: '김철수 상세 보기' });
  expect(kim).toHaveTextContent('AX본부 › 플랫폼팀');
  expect(kim).toHaveTextContent('2026-10-01');
  expect(kim).toHaveTextContent('2026-10-20 09:30');
  expect(kim).toHaveTextContent('iOS 1.7.16');
  expect(kim).toHaveTextContent('Windows 1.7.15');
  expect(kim).toHaveTextContent('Android –');
  expect(kim).toHaveTextContent('Linux 1.8.0');
  const park = screen.getByRole('row', { name: '박영희 상세 보기' });
  expect(park).toHaveTextContent('기록 없음');
  // 기본 정렬은 가입일 내림차순 — 김철수(10-01)가 박영희(09-15)보다 위
  const order = screen.getAllByRole('row').map((r) => r.getAttribute('aria-label')).filter(Boolean);
  expect(order).toEqual(['김철수 상세 보기', '박영희 상세 보기']);
  fireEvent.change(screen.getByLabelText('사용자 검색'), { target: { value: '플랫폼' } });
  expect(screen.queryByRole('row', { name: '박영희 상세 보기' })).toBeNull();
  expect(screen.getByRole('row', { name: '김철수 상세 보기' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('사용자 검색'), { target: { value: '없는사람' } });
  expect(screen.getByText('조건에 맞는 사용자가 없습니다.')).toBeInTheDocument();
});

it('테스트 계정은 사용자 목록에 배지, 카드에 목록·버튼, 삭제는 확인 단계를 거친다', async () => {
  stubFetch([{ ...users[1], user_id: 't1', email: 'review@innogrid.com', display_name: 'Apple Review', role: 'user', test_account: true }],
    [{ id: 't1', email: 'review@innogrid.com', name: 'Apple Review', created_at: '2026-10-23T00:00:00Z', last_sign_in_at: null, disabled: false }]);
  render(<AdminUsersPage />);
  const row = await screen.findByRole('row', { name: 'Apple Review 상세 보기' });
  expect(row).toHaveTextContent('테스트');
  const card = await screen.findByRole('row', { name: '테스트 계정 review@innogrid.com' });
  expect(card).toHaveTextContent('사용 중');
  fireEvent.click(screen.getByRole('button', { name: '삭제' }));
  expect(screen.getByRole('button', { name: '삭제 확인' })).toBeInTheDocument();
  expect(screen.getByText('삭제하면 되돌릴 수 없습니다.')).toBeInTheDocument();
});
