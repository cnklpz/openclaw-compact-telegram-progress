import { CompactProgress } from './aggregator.mjs';

export const PROGRESS_CAPABILITY = 'ordinaryToolProgress.v1';
/** Display-only plugin adapter; the real host keeps compositor and Telegram custody. */
export function createProgressReducer({ signal } = {}) {
  const leases = new WeakMap();
  return event => {
    if (signal?.aborted || !event?.lease || typeof event.lease !== 'object') return;
    let state = leases.get(event.lease);
    if (event.phase === 'begin') {
      if (state) return;
      const s = event.scope;
      if (s?.channel !== 'telegram' || !s.sessionId || !s.sessionKey ||
          (s.threadId !== null && typeof s.threadId !== 'string')) return;
      const scope = { accountId: s.accountId, chatId: s.conversationId,
        threadId: s.threadId ?? '', sessionId: s.sessionId, runId: s.runId };
      const reducer = new CompactProgress({ maxCategories: 3, maxRuns: 1 });
      try { reducer.begin(scope); } catch { return; }
      state = { scope, route: JSON.stringify(s), reducer, closed: event.replay !== false };
      leases.set(event.lease, state);
      return;
    }
    if (!state || state.closed || JSON.stringify(event.scope) !== state.route) return;
    if (['cancel', 'failed', 'settled', 'finalize'].includes(event.phase)) {
      state.closed = true; state.reducer.close(state.scope); return;
    }
    if (event.phase !== 'progress' || event.replay !== false || event.signal?.aborted) return;
    state.reducer.apply(state.scope, event.event);
    return state.reducer.snapshot(state.scope).rows;
  };
}
export function registerProgressPlugin(api) {
  if (api.pluginConfig?.enabled === false) return;
  const capability = api.runtime?.channel?.runtimeContexts?.get({
    channelId: 'telegram', capability: PROGRESS_CAPABILITY,
  });
  if (capability?.version !== 1 || typeof capability.register !== 'function' ||
      !api.lifecycle?.signal || typeof api.lifecycle.onDispose !== 'function') {
    api.logger.warn('compact progress inactive: host ordinaryToolProgress.v1 capability unavailable');
    return;
  }
  const controller = new AbortController();
  const signal = AbortSignal.any([api.lifecycle.signal, controller.signal]);
  try {
    const handle = capability.register({ pluginId: 'compact-telegram-progress', signal,
      onLifecycle: createProgressReducer({ signal }) });
    api.lifecycle.onDispose(() => { controller.abort(); handle.dispose(); });
  } catch {
    controller.abort();
    api.logger.warn('compact progress registration refused; native progress unchanged');
  }
}
