import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactProgress, categoryForTool, scopeKey } from './aggregator.mjs';
const scope = Object.freeze({ accountId: 'bot-a', chatId: '42', threadId: '7', sessionId: 'session-a', runId: 'run-a' });
const start = (callId, toolName, seq) => ({ callId, toolName, seq, phase: 'start' });
const status = (callId, seq, state = 'waiting') => ({ callId, seq, phase: 'status', status: state });
const end = (callId, seq, state = 'completed') => ({ callId, seq, phase: 'end', status: state });
function fixture(options) { const a = new CompactProgress(options); assert.equal(a.begin(scope), true); return a; }
const cats = a => a.snapshot(scope).rows.map(r => r.category);

test('same category reuses row, newest activity moves to last, default keeps three', () => {
  const a = fixture();
  for (const e of [start('r1', 'read', 1), start('e1', 'exec', 2), start('s1', 'web_search', 3), start('r2', 'read', 4)]) a.apply(scope, e);
  assert.deepEqual(cats(a), ['Exec', 'Search', 'Read']);
  a.apply(scope, start('w1', 'write', 5));
  assert.deepEqual(cats(a), ['Search', 'Read', 'Write']);
  assert.equal(a.snapshot(scope).text.split('\n').length, 3);
});
test('status/end target their call even when another category is recent', () => {
  const a = fixture(); a.apply(scope, start('r', 'read', 1)); a.apply(scope, start('e', 'exec', 2));
  a.apply(scope, status('r', 3));
  assert.deepEqual(cats(a), ['Exec', 'Read']);
  a.apply(scope, end('e', 4, 'failed'));
  assert.deepEqual(cats(a), ['Read', 'Exec']);
  assert.equal(a.snapshot(scope).rows.at(-1).status, 'failed');
  assert.equal(a.snapshot(scope).rows[0].status, 'waiting');
});
test('older parallel completion never overwrites latest same-category invocation', () => {
  const a = fixture(); a.apply(scope, start('old', 'read', 1)); a.apply(scope, start('new', 'read', 2));
  a.apply(scope, start('exec', 'exec', 3)); const before = a.snapshot(scope);
  assert.deepEqual(a.apply(scope, end('old', 4, 'failed')), { accepted: true, visibleChanged: false, reason: 'superseded-call' });
  assert.deepEqual(a.snapshot(scope), before);
  a.apply(scope, end('new', 5));
  assert.equal(a.snapshot(scope).rows.at(-1).status, 'completed');
});
test('older parallel status never moves category to most recent', () => {
  const a = fixture(); a.apply(scope, start('o', 'read', 1)); a.apply(scope, start('n', 'read', 2));
  a.apply(scope, start('e', 'exec', 3)); a.apply(scope, status('o', 100));
  assert.deepEqual(cats(a), ['Read', 'Exec']);
});
test('stale or duplicate starts cannot reclaim category ownership', () => {
  const a = fixture(); a.apply(scope, start('n', 'read', 20));
  assert.equal(a.apply(scope, start('o', 'read', 19)).reason, 'stale-start');
  assert.equal(a.apply(scope, start('o', 'read', 20)).reason, 'stale-start');
  assert.equal(a.apply(scope, start('n', 'exec', 21)).reason, 'duplicate-start');
  assert.deepEqual(cats(a), ['Read']);
});
test('out-of-order status and duplicate ends do not regress terminal state', () => {
  const a = fixture(); a.apply(scope, start('r', 'read', 10)); a.apply(scope, status('r', 12));
  assert.equal(a.apply(scope, status('r', 11, 'running')).reason, 'stale-event');
  a.apply(scope, end('r', 13)); const s = a.snapshot(scope);
  for (const e of [status('r', 14), end('r', 15, 'failed'), start('r', 'read', 16)]) assert.equal(a.apply(scope, e).accepted, false);
  assert.deepEqual(a.snapshot(scope), s);
});
test('evicted category current call can return on new activity', () => {
  const a = fixture();
  ['read', 'exec', 'web_search', 'write'].forEach((tool, i) => a.apply(scope, start(String(i), tool, i + 1)));
  assert.deepEqual(cats(a), ['Exec', 'Search', 'Write']);
  a.apply(scope, end('0', 5)); assert.deepEqual(cats(a), ['Search', 'Write', 'Read']);
});
test('category alias mapping is finite and public; unknown names never rendered', () => {
  for (const t of ['Read', 'functions.read', 'host:read']) assert.equal(categoryForTool(t), 'Read');
  for (const t of ['Bash', 'exec', 'process']) assert.equal(categoryForTool(t), 'Exec');
  for (const t of ['web_search', 'skills_search', 'memory_search']) assert.equal(categoryForTool(t), 'Search');
  assert.equal(categoryForTool('camofox_click'), 'Browser');
  assert.equal(categoryForTool('web_fetch'), 'Fetch'); assert.equal(categoryForTool('sessions_spawn'), 'Delegate');
  assert.equal(categoryForTool('SECRET_TOOL_NAME'), 'Other'); assert.equal(categoryForTool(null), 'Other');
  assert.equal(categoryForTool('x'.repeat(201)), 'Other');
});
test('privacy: never read or retain args, output, text, paths, details, errors', () => {
  const a = fixture();
  const event = start('call', 'secret-tool-name', 1);
  for (const field of ['arguments', 'params', 'output', 'result', 'text', 'details', 'error', 'publicSummary']) {
    Object.defineProperty(event, field, { get() { throw Error('private field touched'); } });
  }
  assert.doesNotThrow(() => a.apply(scope, event));
  const done = end('call', 2, 'failed'); done.error = 'api_key=SECRET'; done.output = 'PRIVATE';
  a.apply(scope, done);
  assert.equal(a.snapshot(scope).text, '⚠️ Other · 处理任务 · 未完成');
  assert.equal(JSON.stringify(a.snapshot(scope)).includes('SECRET'), false);
  assert.ok(a.snapshot(scope).rows.every(r => r.text.length < 60));
});
test('explicit run admission and permanent terminal fencing', () => {
  const a = new CompactProgress();
  assert.equal(a.apply(scope, start('r', 'read', 1)).reason, 'unadmitted-run');
  a.begin(scope); a.apply(scope, start('r', 'read', 1)); assert.equal(a.close(scope), true);
  assert.equal(a.begin(scope), false); assert.equal(a.close(scope), false);
  assert.equal(a.apply(scope, end('r', 2)).reason, 'closed-run');
  assert.deepEqual(a.snapshot(scope).rows, []);
});
for (const field of ['accountId', 'chatId', 'threadId', 'sessionId', 'runId']) {
  test(`isolation by ${field}, identical call IDs do not collide`, () => {
    const a = fixture(); const other = { ...scope, [field]: 'different' }; a.begin(other);
    a.apply(scope, start('same', 'read', 1)); a.apply(other, start('same', 'exec', 1)); a.close(scope);
    a.apply(other, end('same', 2));
    assert.deepEqual(a.snapshot(scope).rows, []); assert.equal(a.snapshot(other).rows[0].category, 'Exec');
    assert.equal(a.snapshot(other).rows[0].status, 'completed');
  });
}
test('scope encoding prevents delimiter collisions and rejects missing identity', () => {
  assert.notEqual(scopeKey({ ...scope, accountId: 'a:b', chatId: 'c' }), scopeKey({ ...scope, accountId: 'a', chatId: 'b:c' }));
  for (const field of ['accountId', 'chatId', 'sessionId', 'runId']) assert.throws(() => scopeKey({ ...scope, [field]: '' }), TypeError);
  assert.throws(() => scopeKey({ ...scope, threadId: 3 }), TypeError);
});
test('malformed events and invalid end/status/tool are rejected without state change', () => {
  const a = fixture(); a.apply(scope, start('r', 'read', 1)); const before = a.snapshot(scope);
  const invalid = [null, {}, start('', 'read', 2), start('x', '', 2), start('x', 'read', NaN),
    start('x', 'read', -1), status('r', 2, 'completed'), end('r', 2, 'running'),
    { ...status('r', 2), toolName: 'exec' }, end('unknown', 2), { ...status('r', 2), phase: 'other' }];
  invalid.forEach(e => assert.equal(a.apply(scope, e).accepted, false)); assert.deepEqual(a.snapshot(scope), before);
});
test('config capacity is validated; hard bounds reject rather than evict tombstones', () => {
  for (const n of [0, -1, 1.5, 9, NaN]) assert.throws(() => new CompactProgress({ maxCategories: n }), RangeError);
  const a = fixture({ maxRuns: 1, maxCallsPerRun: 1 });
  a.apply(scope, start('r', 'read', 1)); assert.equal(a.apply(scope, start('e', 'exec', 2)).reason, 'call-capacity');
  a.close(scope); assert.equal(a.begin({ ...scope, runId: 'next' }), false); assert.equal(a.begin(scope), false);
  assert.equal(a.snapshot({ ...scope, runId: 'missing' }), undefined); assert.equal(a.close({ ...scope, runId: 'missing' }), false);
});
test('snapshot is immutable and contains no correlation IDs', () => {
  const a = fixture(); a.apply(scope, start('private-call', 'read', 1)); const s = a.snapshot(scope);
  assert.throws(() => s.rows.push({}), TypeError); assert.throws(() => { s.rows[0].text = 'evil'; }, TypeError);
  assert.equal(JSON.stringify(s).includes('private-call'), false);
});
test('scope normalization is idempotent for no-thread chats and capacities are immutable', () => {
  assert.equal(scopeKey({ ...scope, threadId: undefined }), scopeKey({ ...scope, threadId: '' }));
  const a = fixture(); assert.throws(() => { a.maxCategories = 100; }, TypeError);
  assert.equal(a.maxCategories, 3);
});
test('deterministic 5000-event stress: bound/unique categories and latest-call ownership', () => {
  const a = fixture({ maxCallsPerRun: 10000 }); let seed = 17; let seq = 0;
  const rnd = () => (seed = (seed * 48271) % 2147483647);
  const tools = ['read', 'exec', 'web_search', 'write', 'web_fetch', 'browser', 'sessions_spawn', 'unknown'];
  const latest = new Map(); const calls = []; const visibleOrder = [];
  for (let i = 0; i < 5000; i++) {
    let e, expectedChange;
    if (!calls.length || rnd() % 3 === 0) {
      const tool = tools[rnd() % tools.length], id = `c${i}`, category = categoryForTool(tool);
      e = start(id, tool, ++seq); calls.push({ id, category, terminal: false }); latest.set(category, id); expectedChange = true;
    } else {
      const call = calls[rnd() % calls.length];
      e = rnd() % 2 ? status(call.id, ++seq) : end(call.id, ++seq);
      expectedChange = !call.terminal && latest.get(call.category) === call.id;
      if (e.phase === 'end') call.terminal = true;
    }
    const result = a.apply(scope, e); assert.equal(result.visibleChanged, expectedChange);
    if (expectedChange) {
      const category = categoryForTool(e.toolName) === 'Other' && !e.toolName ? calls.find(c => c.id === e.callId).category : categoryForTool(e.toolName);
      const pos = visibleOrder.indexOf(category); if (pos >= 0) visibleOrder.splice(pos, 1);
      visibleOrder.push(category); if (visibleOrder.length > 3) visibleOrder.shift();
    }
    assert.deepEqual(cats(a), visibleOrder); assert.equal(new Set(cats(a)).size, cats(a).length);
    assert.ok(a.snapshot(scope).rows.length <= 3);
  }
});
