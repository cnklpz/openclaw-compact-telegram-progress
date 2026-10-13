import { CompactProgress } from './aggregator.mjs';
const scope = { accountId: 'demo', chatId: 'demo', sessionId: 'demo', runId: 'demo' };
const a = new CompactProgress(); a.begin(scope);
for (const [callId, toolName, seq] of [['r1', 'read', 1], ['e1', 'exec', 2], ['s1', 'web_search', 3], ['r2', 'read', 4], ['w1', 'write', 5]]) {
  a.apply(scope, { phase: 'start', callId, toolName, seq });
  console.log(`\nSnapshot ${seq}:\n${a.snapshot(scope).text}`);
}
a.apply(scope, { phase: 'end', callId: 'r1', seq: 6, status: 'failed' });
console.log('\nOlder Read completion ignored:\n' + a.snapshot(scope).text);
a.apply(scope, { phase: 'end', callId: 'r2', seq: 7, status: 'completed' });
console.log('\nCurrent Read completion moves its category last:\n' + a.snapshot(scope).text);
console.log('\nDemo is LOCAL ONLY. No Telegram message sent.');
