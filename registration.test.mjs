import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgressReducer, registerProgressPlugin } from './registration.mjs';
const scope = { channel: 'telegram', accountId: 'a', conversationId: 'c', threadId: null,
  sessionKey: 'key', sessionId: 'session', runId: 'run' };
function event(lease, phase, extra = {}) { return { lease, scope, phase, replay: false, ...extra }; }
test('adapter categories use complete host lease and scope, and end once', () => {
  const reducer = createProgressReducer(); const lease = {};
  reducer(event(lease, 'begin'));
  const update = (callId, toolName, seq, phase = 'start', status = 'running') => reducer(event(lease, 'progress', {
    event: { callId, toolName, seq, phase, status, args: 'PRIVATE', result: 'PRIVATE' },
  }));
  update('r1', 'read', 1); update('r2', 'read', 2);
  update('e', 'exec', 3); update('s', 'web_search', 4);
  assert.deepEqual(update('w', 'write', 5).map(row => row.category), ['Exec', 'Search', 'Write']);
  assert.deepEqual(update('r2', 'read', 6, 'end', 'completed').map(row => row.category), ['Search', 'Write', 'Read']);
  assert.equal(update('r1', 'read', 7, 'end', 'completed').at(-1).status, 'completed');
  assert.ok(!JSON.stringify(update('r1', 'read', 8, 'end', 'completed')).includes('PRIVATE'));
  reducer(event(lease, 'settled'));
  assert.equal(update('late', 'exec', 9), undefined);
  reducer(event(lease, 'begin'));
  assert.equal(update('late2', 'exec', 10), undefined);
});
test('adapter refuses unadmitted leases, cross-topic scope and aborted plugin', () => {
  const controller = new AbortController(); const reducer = createProgressReducer({ signal: controller.signal });
  const lease = {};
  assert.equal(reducer(event(lease, 'progress')), undefined);
  reducer(event(lease, 'begin'));
  assert.equal(reducer(event(lease, 'progress', { scope: { ...scope, threadId: 'other' } })), undefined);
  controller.abort();
  assert.equal(reducer(event(lease, 'progress')), undefined);
});
test('registration requires versioned capability plus real lifecycle; never registers modifying hooks', () => {
  const warnings = []; const disposers = []; let registrations = 0;
  const controller = new AbortController();
  const api = { runtime: { channel: { runtimeContexts: { get() { return { version: 1,
    register(params) { assert.equal(params.pluginId, 'compact-telegram-progress'); registrations++;
      return { dispose() { registrations--; } }; } }; } } } },
    lifecycle: { signal: controller.signal, onDispose(fn) { disposers.push(fn); } },
    logger: { warn(text) { warnings.push(text); } }, on() { throw Error('modifying hook forbidden'); } };
  registerProgressPlugin(api); assert.equal(registrations, 1);
  disposers[0](); assert.equal(registrations, 0);
  registerProgressPlugin({ ...api, lifecycle: undefined });
  assert.equal(warnings.length, 1);
  registerProgressPlugin({ ...api, pluginConfig: { enabled: false } });
  assert.equal(registrations, 0);
});
