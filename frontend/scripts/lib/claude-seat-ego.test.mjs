import test from 'node:test';
import assert from 'node:assert/strict';
import { egoRequest } from './claude-seat-ego.mjs';

const simulate = (ownership = 'agent', origin = 'https://claude.ai/new') => {
  const calls = [];
  const run = async (bin, args) => {
    assert.equal(bin, 'ego-browser');
    assert.deepEqual(args.slice(0, 2), ['nodejs', '-e']);
    let stdout = '';
    const page = { url: async () => origin, fetch: async (...args) => {
      calls.push(args); return { status: 200, body: '{"ok":true}' };
    }};
    const Fn = Object.getPrototypeOf(async function(){}).constructor;
    await new Fn('listTaskSpaces', 'taskSpace', 'console', args[2])(
      async () => [{ id: 29, ownership }],
      async id => { assert.equal(id, 29); return { page: name => { assert.equal(name, 'p1'); return page; } }; },
      { log: text => { stdout += text + '\n'; } },
    );
    return { stdout: "", stderr: stdout };
  };
  return { run, calls };
};
test('reuses workspace and forwards PUT exactly once', async () => {
  const { run, calls } = simulate();
  const body = JSON.stringify({ seat_tier: 'team_standard' });
  assert.equal((await egoRequest(29, '/api/organizations/org/members/member', {method:'PUT', body}, run)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].body, body);
});
test('user control blocks browser requests', async () => {
  const { run, calls } = simulate('user');
  await assert.rejects(egoRequest(29, '/api/organizations', {}, run));
  assert.equal(calls.length, 0);
});
test('wrong origin blocks browser requests', async () => {
  const { run, calls } = simulate('agent', 'https://example.com/');
  await assert.rejects(egoRequest(29, '/api/organizations', {}, run));
  assert.equal(calls.length, 0);
});
test('rejects invalid space and API path', async () => {
  await assert.rejects(egoRequest(NaN));
  await assert.rejects(egoRequest(29, '//example.com'));
});
test('write transport failure remains uncertain without leaking command', async () => {
  await assert.rejects(egoRequest(29, '/api/organizations/org/members/member', {method:'PUT'}, async () => { throw Error('PRIVATE COMMAND'); }), e => e.message.includes('outcome unknown') && !e.message.includes('PRIVATE'));
});
