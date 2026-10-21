import test from 'node:test';
import assert from 'node:assert/strict';
import { egoRequest } from './claude-seat-ego.mjs';

const simulate = (ownership = 'agent', origin = 'https://claude.ai/new', spaces = null) => {
  const calls = [], gotos = [];
  const run = async (bin, args) => {
    assert.equal(bin, 'ego-browser');
    assert.deepEqual(args.slice(0, 2), ['nodejs', '-e']);
    let stdout = '';
    const page = { url: async () => origin, goto: async url => { gotos.push(url); origin = url; }, fetch: async (...args) => {
      calls.push(args); return { status: 200, body: '{"ok":true}' };
    }};
    const Fn = Object.getPrototypeOf(async function(){}).constructor;
    await new Fn('listTaskSpaces', 'taskSpace', 'console', args[2])(
      async () => spaces ?? [{ id: 29, name: 'claude-seat-executor', ownership }],
      async name => { assert.equal(name, 'claude-seat-executor'); return { page: name => { assert.equal(name, 'p1'); return page; } }; },
      { log: text => { stdout += text + '\n'; } },
    );
    return { stdout: "", stderr: stdout };
  };
  return { run, calls, gotos };
};
test('reuses workspace and forwards PUT exactly once', async () => {
  const { run, calls } = simulate();
  const body = JSON.stringify({ seat_tier: 'team_standard' });
  assert.equal((await egoRequest('claude-seat-executor', '/api/organizations/org/members/member', {method:'PUT', body}, run)).status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].body, body);
});
test('user control blocks browser requests', async () => {
  const { run, calls } = simulate('user');
  await assert.rejects(egoRequest('claude-seat-executor', '/api/organizations', {}, run));
  assert.equal(calls.length, 0);
});
test('tab off claude.ai is moved back before the request', async () => {
  const { run, calls, gotos } = simulate('agent', 'about:blank');
  assert.equal((await egoRequest('claude-seat-executor', '/api/organizations', {}, run)).status, 200);
  assert.deepEqual(gotos, ['https://claude.ai/new']);
  assert.equal(calls.length, 1);
});
test('missing workspace is reopened by name (ego restart drops spaces)', async () => {
  const { run, calls } = simulate('agent', 'https://claude.ai/new', []);
  assert.equal((await egoRequest('claude-seat-executor', '/api/organizations', {}, run)).status, 200);
  assert.equal(calls.length, 1);
});
test('rejects invalid space and API path', async () => {
  await assert.rejects(egoRequest(32));
  await assert.rejects(egoRequest('a"; evil'));
  await assert.rejects(egoRequest('claude-seat-executor', '//example.com'));
});
test('write transport failure remains uncertain without leaking command', async () => {
  await assert.rejects(egoRequest('claude-seat-executor', '/api/organizations/org/members/member', {method:'PUT'}, async () => { throw Error('PRIVATE COMMAND'); }), e => e.message.includes('outcome unknown') && !e.message.includes('PRIVATE'));
});
