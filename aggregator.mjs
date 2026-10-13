/** Pure reducer. No SDK internals, credentials, network, arguments or result rendering. */
const TOOLS = Object.freeze({
  read: 'Read', ls: 'Read', file_fetch: 'Read', dir_list: 'Read', dir_fetch: 'Read',
  exec: 'Exec', bash: 'Exec', process: 'Exec', terminal: 'Exec',
  search: 'Search', web_search: 'Search', memory_search: 'Search', tool_search: 'Search',
  skills_search: 'Search', sessions_search: 'Search',
  write: 'Write', edit: 'Write', apply_patch: 'Write', file_write: 'Write',
  web_fetch: 'Fetch', browser: 'Browser', computer: 'Browser',
  sessions_spawn: 'Delegate', subagents: 'Delegate', agents_wait: 'Delegate',
});
const LABELS = Object.freeze({ Read: '读取资料', Exec: '执行操作', Search: '检索信息',
  Write: '更新文件', Fetch: '获取资料', Browser: '操作页面', Delegate: '协作处理', Other: '处理任务' });
const ICONS = Object.freeze({ running: '⏳', waiting: '…', completed: '✅', failed: '⚠️', cancelled: '⏹' });
const SUFFIX = Object.freeze({ running: '进行中', waiting: '等待中', completed: '已完成', failed: '未完成', cancelled: '已取消' });
const END = new Set(['completed', 'failed', 'cancelled']);
function nonempty(x) { return typeof x === 'string' && x.length > 0 && x.length <= 1024; }
export function normalizeScope(scope) {
  if (!scope || !['accountId', 'chatId', 'sessionId', 'runId'].every(k => nonempty(scope[k])) ||
      (scope.threadId !== undefined && scope.threadId !== '' && !nonempty(scope.threadId))) throw new TypeError('Explicit account/chat/session/run identities required');
  return Object.freeze(Object.fromEntries(['accountId', 'chatId', 'threadId', 'sessionId', 'runId']
    .map(k => [k, scope[k] ?? ''])));
}
export function scopeKey(scope) { const s = normalizeScope(scope); return JSON.stringify(Object.values(s)); }
export function categoryForTool(name) {
  if (typeof name !== 'string' || name.length > 200) return 'Other';
  const tool = name.toLowerCase().split(/[.:/]/).at(-1);
  if (tool.startsWith('camofox_')) return 'Browser';
  return TOOLS[tool] ?? 'Other';
}
function bounded(n, fallback, max) {
  n ??= fallback;
  if (!Number.isSafeInteger(n) || n < 1 || n > max) throw new RangeError('Invalid capacity');
  return n;
}

export class CompactProgress {
  #runs = new Map();
  constructor({ maxCategories = 3, maxRuns = 512, maxCallsPerRun = 4096 } = {}) {
    this.maxCategories = bounded(maxCategories, 3, 8);
    this.maxRuns = bounded(maxRuns, 512, 100000);
    this.maxCallsPerRun = bounded(maxCallsPerRun, 4096, 100000);
    Object.freeze(this); // capacities cannot be changed after validation
  }
  /** Explicit admission only: no event can implicitly create/reopen a run. */
  begin(scope) {
    const key = scopeKey(scope);
    if (this.#runs.has(key)) return false;
    // Do not evict terminal tombstones: that would permit late reactivation.
    if (this.#runs.size >= this.maxRuns) return false;
    this.#runs.set(key, { scope: normalizeScope(scope), closed: false, revision: 0,
      calls: new Map(), categories: new Map(), order: [] });
    return true;
  }
  apply(scope, event) {
    const r = this.#runs.get(scopeKey(scope));
    const reject = reason => ({ accepted: false, visibleChanged: false, reason });
    if (!r) return reject('unadmitted-run');
    if (r.closed) return reject('closed-run');
    if (!event || !nonempty(event.callId) || !Number.isSafeInteger(event.seq) || event.seq < 0 ||
        !['start', 'status', 'end'].includes(event.phase)) return reject('invalid-event');
    let call = r.calls.get(event.callId);
    if (event.phase === 'start') {
      if (call) return reject('duplicate-start');
      if (!nonempty(event.toolName)) return reject('missing-tool');
      if (r.calls.size >= this.maxCallsPerRun) return reject('call-capacity');
      const category = categoryForTool(event.toolName);
      const prior = r.categories.get(category);
      // A delayed/replayed older start must not take ownership from a newer call.
      if (prior && event.seq <= prior.startSeq) return reject('stale-start');
      call = { category, toolName: event.toolName, startSeq: event.seq,
        seq: event.seq, status: 'running', terminal: false };
      r.calls.set(event.callId, call);
      r.categories.set(category, { callId: event.callId, startSeq: event.seq, status: call.status });
    } else {
      if (!call) return reject('unknown-call');
      if (event.toolName !== undefined && event.toolName !== call.toolName) return reject('tool-mismatch');
      if (call.terminal) return reject('terminal-call');
      if (event.seq <= call.seq) return reject('stale-event');
      const allowed = event.phase === 'status' ? ['running', 'waiting'] : [...END];
      if (!allowed.includes(event.status)) return reject('invalid-status');
      call.seq = event.seq;
      call.status = event.status;
      call.terminal = END.has(event.status);
      const row = r.categories.get(call.category);
      // Completion/status of an older parallel call must never overwrite the latest one.
      if (row.callId !== event.callId) return { accepted: true, visibleChanged: false, reason: 'superseded-call' };
      row.status = call.status;
    }
    // Most recently accepted activity is last; evicted categories can re-enter.
    r.order = [...r.order.filter(c => c !== call.category), call.category].slice(-this.maxCategories);
    r.revision++;
    return { accepted: true, visibleChanged: true, reason: 'updated' };
  }
  close(scope) {
    const r = this.#runs.get(scopeKey(scope));
    if (!r || r.closed) return false;
    r.closed = true;
    r.revision++;
    r.calls.clear(); r.categories.clear(); r.order = [];
    return true;
  }
  snapshot(scope) {
    const r = this.#runs.get(scopeKey(scope));
    if (!r) return undefined;
    const rows = r.order.map(category => {
      const status = r.categories.get(category).status;
      return Object.freeze({ category, status, text: `${ICONS[status]} ${category} · ${LABELS[category]} · ${SUFFIX[status]}` });
    });
    return Object.freeze({ closed: r.closed, revision: r.revision, rows: Object.freeze(rows),
      text: rows.map(row => row.text).join('\n') });
  }
}
