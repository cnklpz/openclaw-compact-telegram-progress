import test from 'node:test';
import assert from 'node:assert/strict';
import { CompactProgress, scopeKey } from './aggregator.mjs';
import { TemporaryCard } from './lifecycle.mjs';
const scope = { accountId: 'bot-a', chatId: '42', sessionId: 's', runId: 'r' };
const event = (id, tool, seq) => ({ callId: id, toolName: tool, phase: 'start', seq });
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function setup(overrides = {}) {
  const reducer = new CompactProgress(); reducer.begin(scope); const calls = [];
  const port = {
    async createPreview(s, text) { calls.push(['create', text]); return { kind: 'temporary-progress', scopeKey: scopeKey(s), messageId: 'preview' }; },
    async editPreview(h, text) { calls.push(['edit', h.messageId, text]); },
    async deletePreview(h) { calls.push(['delete', h.messageId]); }, ...overrides,
  };
  const card = new TemporaryCard({ scope, reducer, port });
  const push = (e) => { reducer.apply(scope, e); return card.update(); };
  const receipt = { kind: 'normal-final', success: true, scopeKey: scopeKey(scope), messageIds: ['final'] };
  return { reducer, card, calls, push, receipt };
}
test('one create, edits same card, latest pending snapshot coalesced', async () => {
  const f = setup(); f.push(event('r1', 'read', 1)); f.push(event('e1', 'exec', 2));
  assert.equal((await f.card.flush()).visible, true); assert.equal(f.calls.length, 1);
  f.push(event('s1', 'web_search', 3)); f.push(event('r2', 'read', 4));
  await Promise.all([f.card.flush(), f.card.flush(), f.card.flush()]);
  assert.deepEqual(f.calls.map(c => c[0]), ['create', 'edit']);
  assert.equal(f.calls[1][1], 'preview'); assert.ok(f.calls[1][2].endsWith('⏳ Read · 读取资料 · 进行中'));
});
test('same public text not edited again; revisions are accepted once', async () => {
  const f = setup(); assert.equal(f.card.update(), false); await f.card.flush();
  f.push(event('r1', 'read', 1)); await f.card.flush(); assert.equal(f.card.update(), false);
  f.push(event('r2', 'read', 2)); assert.equal((await f.card.flush()).reason, 'unchanged'); assert.equal(f.calls.length, 1);
});
test('normal final arrives, temporary card deleted, late events blocked', async () => {
  const f = setup(); f.push(event('r', 'read', 1)); await f.card.flush();
  await f.card.finalStarted(); assert.equal((await f.card.finalDelivered(f.receipt)).cleaned, true);
  assert.deepEqual(f.calls.at(-1), ['delete', 'preview']); assert.equal(f.reducer.snapshot(scope).closed, true);
  assert.equal(f.reducer.apply(scope, event('e', 'exec', 2)).reason, 'closed-run');
  assert.equal(f.card.update(), false); assert.equal((await f.card.flush()).visible, false);
  assert.equal((await f.card.finalDelivered(f.receipt)).reason, 'no-preview');
});
test('failed/unconfirmed/wrong-run finals never delete preview', async () => {
  const f = setup(); f.push(event('r', 'read', 1)); await f.card.flush(); await f.card.finalStarted();
  for (const receipt of [null, {}, { ...f.receipt, success: false }, { ...f.receipt, kind: 'tool' },
    { ...f.receipt, scopeKey: 'wrong' }, { ...f.receipt, messageIds: [] }, { ...f.receipt, messageIds: [null] }]) {
    assert.equal((await f.card.finalDelivered(receipt)).reason, 'unconfirmed-final');
  }
  assert.equal((await f.card.retryCleanup()).reason, 'no-confirmed-final'); assert.equal(f.calls.length, 1);
});
test('cleanup failure retains deletion custody, explicit retry never targets final', async () => {
  const deletes = []; let fail = true;
  const f = setup({ async deletePreview(h) { deletes.push(h.messageId); if (fail) throw Error('token=PRIVATE'); } });
  f.push(event('r', 'read', 1)); await f.card.flush(); await f.card.finalStarted();
  assert.deepEqual(await f.card.finalDelivered(f.receipt), { cleaned: false, reason: 'cleanup-failed' });
  fail = false; assert.equal((await f.card.retryCleanup()).cleaned, true);
  assert.deepEqual(deletes, ['preview', 'preview']); assert.equal(deletes.includes('final'), false);
});
test('promoted preview is protected as final, even on repeated cleanup', async () => {
  const f = setup(); f.push(event('r', 'read', 1)); await f.card.flush(); await f.card.finalStarted();
  assert.equal((await f.card.finalDelivered({ ...f.receipt, messageIds: ['preview', 'another-final-chunk'] })).reason, 'preview-is-final');
  await f.card.retryCleanup(); assert.equal(f.calls.some(c => c[0] === 'delete'), false);
});
test('final confirmation during an in-flight create cleans late preview exactly once', async () => {
  const gate = deferred(), entered = deferred(); const deletes = [];
  const f = setup({ async createPreview(s) { entered.resolve(); await gate.promise; return { kind: 'temporary-progress', scopeKey: scopeKey(s), messageId: 'late-preview' }; },
    async deletePreview(h) { deletes.push(h.messageId); } });
  f.push(event('r', 'read', 1)); const flush = f.card.flush(); await entered.promise;
  const delivered = f.card.finalDelivered(f.receipt); f.card.update(); gate.resolve();
  await flush; assert.equal((await delivered).cleaned, true); assert.deepEqual(deletes, ['late-preview']);
});
test('finalStarted joins outstanding edit before host final send, queued edits cancelled', async () => {
  const gate = deferred(), entered = deferred(); const edits = [];
  const f = setup({ async editPreview(h, text) { edits.push(text); entered.resolve(); await gate.promise; } });
  f.push(event('r', 'read', 1)); await f.card.flush(); f.push(event('e', 'exec', 2));
  const edit = f.card.flush(); await entered.promise;
  f.push(event('s', 'web_search', 3)); const queued = f.card.flush();
  let quiesced = false; const finalStart = f.card.finalStarted().then(() => { quiesced = true; });
  await Promise.resolve(); assert.equal(quiesced, false); gate.resolve();
  await Promise.all([edit, queued, finalStart]); assert.equal(quiesced, true); assert.equal(edits.length, 1);
  await f.card.finalDelivered(f.receipt); assert.deepEqual(f.calls.at(-1), ['delete', 'preview']);
});
test('updates while edit is in-flight never apply older snapshot after newer one', async () => {
  const gate = deferred(), entered = deferred(); let count = 0; const texts = [];
  const f = setup({ async editPreview(h, text) { texts.push(text); if (++count === 1) { entered.resolve(); await gate.promise; } } });
  f.push(event('r', 'read', 1)); await f.card.flush(); f.push(event('e', 'exec', 2));
  const first = f.card.flush(); await entered.promise; f.push(event('s', 'web_search', 3));
  const second = f.card.flush(); f.push(event('w', 'write', 4)); gate.resolve(); await Promise.all([first, second]);
  assert.equal(texts.length, 2); assert.ok(texts[1].endsWith('⏳ Write · 更新文件 · 进行中'));
  assert.equal(texts[1].includes('Read'), false);
});
test('failed create and edit are not visible; owner can retry, errors not exposed', async () => {
  let createFail = true, editFail = true;
  const f = setup({ async createPreview(s) { if (createFail) throw Error('SECRET'); return { kind: 'temporary-progress', scopeKey: scopeKey(s), messageId: 'preview' }; },
    async editPreview() { if (editFail) throw Error('SECRET'); } });
  f.push(event('r', 'read', 1)); assert.deepEqual(await f.card.flush(), { visible: false, reason: 'transport-failed' });
  createFail = false; assert.equal((await f.card.flush()).visible, true); f.push(event('e', 'exec', 2));
  assert.equal((await f.card.flush()).visible, false); editFail = false; assert.equal((await f.card.flush()).visible, true);
});
test('failed older edit does not replace newer pending update with old snapshot', async () => {
  const gate = deferred(), entered = deferred(); let count = 0; let latest;
  const f = setup({ async editPreview(h, text) { if (++count === 1) { entered.resolve(); await gate.promise; throw Error('old edit failed'); } latest = text; } });
  f.push(event('r', 'read', 1)); await f.card.flush(); f.push(event('e', 'exec', 2)); const old = f.card.flush();
  await entered.promise; f.push(event('w', 'write', 3)); gate.resolve(); await old; await f.card.flush();
  assert.ok(latest.endsWith('⏳ Write · 更新文件 · 进行中'));
});
test('invalid or foreign handles cannot be edited or deleted', async () => {
  for (const h of [{ kind: 'normal-final', scopeKey: scopeKey(scope), messageId: 'final' },
    { kind: 'temporary-progress', scopeKey: 'other-account', messageId: 'foreign' },
    { kind: 'temporary-progress', scopeKey: scopeKey(scope), messageId: '' }]) {
    const f = setup({ async createPreview() { return h; } }); f.push(event('r', 'read', 1));
    assert.equal((await f.card.flush()).reason, 'invalid-preview-receipt');
    assert.equal((await f.card.finalDelivered(f.receipt)).reason, 'no-preview'); assert.deepEqual(f.calls, []);
  }
});
test('no preview on text-only turn; cleanup no-op, constructor fail-closed', async () => {
  const f = setup(); assert.equal((await f.card.finalDelivered(f.receipt)).reason, 'no-preview');
  assert.equal(f.calls.length, 0);
  assert.throws(() => new TemporaryCard({ scope, reducer: new CompactProgress(), port: {} }), /admitted/);
  assert.throws(() => new TemporaryCard({ scope, reducer: f.reducer, port: {} }), /host-owned/);
});
test('external run closure drops pending preview without deleting unconfirmed messages', async () => {
  const f = setup(); f.push(event('r', 'read', 1)); f.reducer.close(scope);
  assert.equal(f.card.update(), false); assert.equal((await f.card.flush()).reason, 'closed-run');
  assert.deepEqual(f.calls, []);
});
test('cleanup failure followed by preview promotion never retries deletion of final ID', async () => {
  const deleted = [];
  const f = setup({ async deletePreview(h) { deleted.push(h.messageId); throw Error('cleanup failed'); } });
  f.push(event('r', 'read', 1)); await f.card.flush(); await f.card.finalStarted();
  assert.equal((await f.card.finalDelivered(f.receipt)).reason, 'cleanup-failed');
  assert.equal((await f.card.finalDelivered({ ...f.receipt, messageIds: ['preview'] })).reason, 'preview-is-final');
  await f.card.retryCleanup(); assert.deepEqual(deleted, ['preview']);
});
