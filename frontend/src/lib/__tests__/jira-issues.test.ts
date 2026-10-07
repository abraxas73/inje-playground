// @vitest-environment node
import { expect, it, vi } from "vitest";
import { adfText, issueDetail, myIssues, updateIssue } from "@/lib/jira/issues";
const issue = { key: "AX-12", fields: { summary: "업무", assignee: { accountId: "me" }, status: { id: "1", name: "진행 중", statusCategory: { key: "indeterminate" } }, description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "<script>내용</script>" }] }] } } };
function client(owned = true, required = false) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === "POST") return null;
    if (path.includes('/transitions')) return { transitions: [{ id: '2', name: '완료', to: { name: '완료' }, fields: required ? { resolution: { required: true, name: '해결 방법' } } : {} }] };
    if (path.includes('/comment')) return { comments: [], total: 0 };
    return owned ? issue : { ...issue, fields: { ...issue.fields, assignee: { accountId: 'other' } } };
  });
}
it('검색은 개인 토큰의 currentUser 담당에 고정되고 진행 중 분류 및 커서를 적용한다', async () => {
  const fetch = vi.fn().mockResolvedValue({ issues: [issue], nextPageToken: 'next', isLast: false });
  const result = await myIssues(fetch, 'progress', 'previous');
  const body = JSON.parse(fetch.mock.calls[0][1].body);
  expect(body.jql).toBe('assignee = currentUser() AND statusCategory = "In Progress" ORDER BY updated DESC');
  expect(body.nextPageToken).toBe('previous');
  expect(result.items[0]).toMatchObject({ key: 'AX-12', status: '진행 중' });
  expect(result.nextPageToken).toBe('next');
});
it('다른 담당자의 이슈는 상세·댓글·상태 변경 전에 거부한다', async () => {
  const fetch = client(false);
  await expect(issueDetail(fetch, 'me', 'AX-12')).rejects.toMatchObject({ status: 403 });
  await expect(updateIssue(fetch, 'me', 'AX-12', { action: 'comment', text: '안녕' })).rejects.toMatchObject({ status: 403 });
  expect(fetch.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it('서버에 다시 조회한 전환만 실행하며 필수 필드를 임의로 채우지 않는다', async () => {
  const fetch = client(true, true);
  await expect(updateIssue(fetch, 'me', 'AX-12', { action: 'transition', transitionId: '2', expectedStatus: '1' })).rejects.toMatchObject({ status: 400 });
  expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  await expect(updateIssue(client(), 'me', 'AX-12', { action: 'transition', transitionId: '2', expectedStatus: 'old' })).rejects.toMatchObject({ status: 409 });
  await expect(updateIssue(client(), 'me', 'AX-12', { action: 'transition', transitionId: 'fake', expectedStatus: '1' })).rejects.toMatchObject({ status: 409 });
});
it('유효한 상태 변경과 댓글은 본인 이슈에 한 번만 쓰고 요청의 임의 필드는 전달하지 않는다', async () => {
  const fetch = client();
  await updateIssue(fetch, 'me', 'AX-12', { action: 'transition', transitionId: '2', expectedStatus: '1', fields: { assignee: 'other' } });
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([['/rest/api/3/issue/AX-12/transitions', { method: 'POST', body: '{"transition":{"id":"2"}}' }]]);
  fetch.mockClear();
  await updateIssue(fetch, 'me', 'AX-12', { action: 'comment', text: '첫 줄\n둘째 줄' });
  const posts = fetch.mock.calls.filter(([, init]) => init?.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1]!.body as string).body.content).toHaveLength(2);
});
it('경로 조작과 빈 댓글·초과 댓글을 거부하고 본문은 실행할 HTML이 아닌 텍스트로 변환', async () => {
  const fetch = client();
  await expect(issueDetail(fetch, 'me', '../users')).rejects.toMatchObject({ status: 400 });
  expect(fetch).not.toHaveBeenCalled();
  for (const text of ['', 'a'.repeat(4001)]) await expect(updateIssue(fetch, 'me', 'AX-12', { action: 'comment', text })).rejects.toMatchObject({ status: 400 });
  expect(adfText(issue.fields.description)).toBe('<script>내용</script>\n');
});
