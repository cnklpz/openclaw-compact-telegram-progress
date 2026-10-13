import { definePluginEntry } from 'openclaw/plugin-sdk/plugin-entry';
import { registerProgressPlugin } from './registration.mjs';
export default definePluginEntry({ id: 'compact-telegram-progress', name: 'Compact Telegram progress',
  description: 'Display-only ordinary tool category rows via the host-owned compositor bridge.',
  register: registerProgressPlugin });
