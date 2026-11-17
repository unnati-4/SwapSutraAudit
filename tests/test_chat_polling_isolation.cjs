// Exercise the actual App effect with delayed HTTP responses and controlled timers.
const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const { transformSync } = require('esbuild');
const source = fs.readFileSync(require('path').join(__dirname, '../src/App.tsx'), 'utf8');
const start = source.indexOf('  // Polling for active chat messages');
const effect = source.slice(start, source.indexOf('  const [showHostModal', start));
const js = transformSync(effect, { loader: 'ts' }).code;
let pass = 0;
const check = (name, condition) => { assert.ok(condition, name); pass++; console.log('PASS ' + name); };
const timers = new Map(), requests = [], listeners = new Set();
let timerId = 0, messages = [], loading = false;
const refresh = { current: null };
const flush = () => new Promise(resolve => setImmediate(resolve));
function mount(chatId) {
  let cleanup;
  const c = {
    activeChat: chatId ? { chatId } : null, activeUserEmail: 'reader@example.com',
    API_URL: '/api/swapsutra', encodeURIComponent, AbortController, console,
    setMessages: value => { messages = typeof value === 'function' ? value(messages) : value; },
    setLoadingMessages: value => { loading = value; },
    chatRefreshNowRef: refresh,
    document: { visibilityState: 'visible', addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) },
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    secureFetch: (url, options) => new Promise(resolve => requests.push({ url, signal: options.signal, resolve: data => resolve({ json: async () => data }) })),
    useEffect: fn => { cleanup = fn(); },
  };
  vm.runInNewContext(js, c);
  return cleanup;
}
(async () => {
  const stopA = mount('A');
  check('First chat starts one request', requests.length === 1 && loading);
  const oldRefresh = refresh.current;
  stopA();
  const stopB = mount('B');
  check('Changing chat aborts the old request', requests[0].signal.aborted);
  check('Changing chat clears the previous messages', messages.length === 0);
  requests[1].resolve([{ messageId: 'B1', chatId: 'B', message: 'B message' }]); await flush();
  check('Selected chat response is displayed', messages[0].chatId === 'B');
  requests[0].resolve([{ messageId: 'A1', chatId: 'A', message: 'late A message' }]); await flush();
  check('Late old response cannot replace selected chat', messages[0].chatId === 'B');
  check('Old request cannot restart a polling timer', timers.size === 1);
  oldRefresh(); await flush();
  check('Old refresh callback is inert', requests.length === 2);
  refresh.current(); refresh.current(); refresh.current();
  check('Repeated refreshes coalesce into one request', requests.length === 3);
  requests[2].resolve([{ messageId: 'B2', chatId: 'B', message: 'updated B' }]); await flush();
  check('Only one timer survives repeated refresh', timers.size === 1);
  const [id, next] = [...timers.entries()][0]; timers.delete(id); const tick = next.fn();
  check('Queued refresh runs on the selected chat', requests.length === 4 && requests[3].url.includes('chatId=B'));
  stopB();
  requests[3].resolve([{ messageId: 'B3', chatId: 'B', message: 'closed' }]); await tick; await flush();
  check('Closing chat prevents late updates', messages[0].messageId === 'B2');
  check('Closing removes timers and listeners', timers.size === 0 && listeners.size === 0 && refresh.current === null);
  mount(null);
  check('No selection clears messages and loading', messages.length === 0 && loading === false);
  check('Chat modal remounts its room state for a different ID', source.includes('<ChatModal key={activeChat.chatId}'));
  console.log(`\n${pass} passed, 0 failed`);
})().catch(e => { console.error(e); process.exit(1); });
