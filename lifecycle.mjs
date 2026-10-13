import { normalizeScope, scopeKey } from './aggregator.mjs';

/**
 * Contract harness, NOT a Telegram transport or SDK adapter.
 * A future host bridge supplies current-authority, throttled create/edit/delete capabilities.
 * Handles must belong exclusively to this temporary card; never adopt an arbitrary message ID.
 */
export class TemporaryCard {
  #scope; #key; #reducer; #port; #handle; #pending; #tail = Promise.resolve();
  #halted = false; #delivered = false; #protected = new Set(); #lastText; #lastRevision = -1;
  constructor({ scope, reducer, port }) {
    this.#scope = normalizeScope(scope); this.#key = scopeKey(scope);
    if (!reducer.snapshot(scope)) throw new Error('Run must be admitted first');
    if (!port || !['createPreview', 'editPreview', 'deletePreview'].every(k => typeof port[k] === 'function')) {
      throw new TypeError('A host-owned preview capability is required');
    }
    this.#reducer = reducer; this.#port = port;
  }
  #serialize(fn) {
    const p = this.#tail.then(fn);
    this.#tail = p.catch(() => {});
    return p;
  }
  #validHandle(h) {
    return h && h.kind === 'temporary-progress' && h.scopeKey === this.#key &&
      typeof h.messageId === 'string' && h.messageId.length > 0;
  }
  /** Caller feeds snapshots from its own run, not arbitrary/model-authored text. */
  update() {
    if (this.#halted) return false;
    const s = this.#reducer.snapshot(this.#scope);
    if (!s || s.closed || !s.text || s.revision <= this.#lastRevision) return false;
    this.#lastRevision = s.revision; this.#pending = s;
    return true;
  }
  /** Host scheduler chooses when to flush; coalesces edits, no timers or retry loops here. */
  flush() {
    return this.#serialize(async () => {
      if (this.#halted || !this.#pending) return { visible: false, reason: 'idle' };
      if (this.#reducer.snapshot(this.#scope).closed) {
        this.#halted = true; this.#pending = undefined;
        return { visible: false, reason: 'closed-run' };
      }
      const s = this.#pending; this.#pending = undefined;
      if (s.text === this.#lastText) return { visible: false, reason: 'unchanged' };
      try {
        if (!this.#handle) {
          const h = await this.#port.createPreview(this.#scope, s.text);
          if (!this.#validHandle(h)) return { visible: false, reason: 'invalid-preview-receipt' };
          this.#handle = Object.freeze({ kind: h.kind, scopeKey: h.scopeKey, messageId: h.messageId });
        } else {
          if (this.#protected.has(this.#handle.messageId)) return { visible: false, reason: 'protected-final' };
          await this.#port.editPreview(this.#handle, s.text);
        }
        this.#lastText = s.text;
        return { visible: true, reason: 'accepted' };
      } catch {
        // No raw transport errors/output in a public status; explicit owner retries only.
        if (!this.#halted && (!this.#pending || this.#pending.revision < s.revision)) this.#pending = s;
        return { visible: false, reason: 'transport-failed' };
      }
    });
  }
  /** Mandatory before host final send/promotion: freeze synchronously and join in-flight edits. */
  finalStarted() {
    this.#halted = true; this.#pending = undefined;
    this.#reducer.close(this.#scope);
    return this.#serialize(() => ({ reason: 'quiesced' }));
  }
  /** Only confirmed NORMAL final delivery authorizes cleanup, never agent_end or tool end. */
  finalDelivered(receipt) {
    if (!receipt || receipt.scopeKey !== this.#key || receipt.kind !== 'normal-final' ||
        receipt.success !== true || !Array.isArray(receipt.messageIds) || receipt.messageIds.length === 0 ||
        !receipt.messageIds.every(id => typeof id === 'string' && id.length > 0)) {
      return Promise.resolve({ cleaned: false, reason: 'unconfirmed-final' });
    }
    this.#halted = true; this.#pending = undefined; this.#delivered = true;
    this.#reducer.close(this.#scope);
    for (const id of receipt.messageIds) this.#protected.add(id);
    return this.retryCleanup();
  }
  retryCleanup() {
    return this.#serialize(async () => {
      if (!this.#delivered) return { cleaned: false, reason: 'no-confirmed-final' };
      if (!this.#handle) return { cleaned: true, reason: 'no-preview' };
      // The host might have promoted it: this ID is now permanently protected.
      if (this.#protected.has(this.#handle.messageId)) {
        this.#handle = undefined;
        return { cleaned: false, reason: 'preview-is-final' };
      }
      try {
        await this.#port.deletePreview(this.#handle);
        this.#handle = undefined;
        return { cleaned: true, reason: 'deleted' };
      } catch {
        // Keep exclusive deletion custody for an explicit retry; never fall back to final ID.
        return { cleaned: false, reason: 'cleanup-failed' };
      }
    });
  }
}
