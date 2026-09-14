import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { config, pending } from '../dist/lib/config.js';
import { BrowserWallet, WalletDiscovery, walletError, formatTokens } from '../dist/lib/wallet.js';
import { scheduleAt, countdown, FIRST_ENTRY_MS } from '../dist/lib/schedule.js';

const source = (await readFile(new URL('../dist/app.js', import.meta.url), 'utf8')).replace(/^import .+;\r?\n/gm, '');
const activation = Date.UTC(2026, 8, 11, 12), address = '0x' + '1'.repeat(40);
const token = { address: '0x' + '3'.repeat(40), chainId: 4663, decimals: 18 };

class Element extends EventTarget {
  constructor(tagName = 'div', attributes = {}) {
    super(); Object.assign(this, { tagName, attributes, children: [], style: {}, value: '', disabled: false, _text: '' });
    const classes = new Set();
    this.classList = { add: name => classes.add(name), toggle: (name, value) => value ? classes.add(name) : classes.delete(name) };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { this.textContent = String(value).replace(/<[^>]+>/g, ''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
class Document extends EventTarget {
  constructor(nodes = []) { super(); this.nodes = nodes; this.hidden = false; }
  createElement(tag) { return new Element(tag); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    return this.nodes.filter(node => selector.split(',').some(part => {
      part = part.trim();
      if (part.startsWith('#')) return node.attributes.id === part.slice(1);
      const attribute = part.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
      return attribute && Object.hasOwn(node.attributes, attribute[1])
        && (attribute[2] === undefined || node.attributes[attribute[1]] === attribute[2]);
    }));
  }
}
function liveState(now = activation) {
  return { serverNow: now, activatedAt: activation, token, ...scheduleAt(activation, now),
    participants: 0, nextParticipants: 0, myCurrentEntry: null, myNextEntry: null, pool: null };
}
function fixture({ nodes = [], state = liveState(), provider, preference } = {}) {
  const document = new Document(nodes), window = new EventTarget(), intervals = [], events = [], requests = [];
  const storage = new Map(preference ? [['arena:wallet-provider', preference]] : []);
  window.ethereum = provider;
  window.addEventListener('arena:state', event => events.push(event.detail));
  let elapsed = 100, response = state;
  const context = vm.createContext({
    config, pending, BrowserWallet, WalletDiscovery, walletError, formatTokens, scheduleAt, countdown,
    document, window, location: { origin: 'https://apex-round.com' },
    Event, CustomEvent, structuredClone, AbortSignal, performance: { now: () => elapsed },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: (callback, ms) => { intervals.push({ callback, ms }); },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const body = await response;
      if (body instanceof Error) throw body;
      return { ok: true, json: async () => structuredClone(body) };
    },
  });
  vm.runInContext(source, context, { filename: 'app.js' });
  return { document, window, events, requests, storage,
    latest: () => events.at(-1),
    response: value => { response = value; },
    advance: ms => { elapsed += ms; for (const timer of intervals) if (timer.ms === 1000) timer.callback(); },
  };
}
const settle = async () => { for (let index = 0; index < 5; index++) await new Promise(resolve => setImmediate(resolve)); };
const element = (id, tag = 'div') => new Element(tag, { id });

test('A page without arena, wallet form or FAQ elements still publishes live state and answers state requests', async () => {
  const app = fixture();
  await settle();
  assert.equal(app.latest().ready, true);
  assert.equal(app.latest().schedule.phase, 'registration');
  assert.equal(app.latest().state.activatedAt, activation);
  const count = app.events.length;
  app.window.dispatchEvent(new Event('arena:state-request'));
  assert.equal(app.events.length, count + 1);
  app.latest().state.activatedAt = 0;
  app.window.dispatchEvent(new Event('arena:state-request'));
  assert.equal(app.latest().state.activatedAt, activation, 'Consumers cannot mutate authoritative runtime state');
  assert.ok(app.requests.every(request => request.options.method === 'GET'));
});

test('Optional repeated state fields share the same main timer and expire without inventing a new schedule', async () => {
  const timer = element('timer'), repeated = new Element('strong', { 'data-state': 'timer' });
  const status = new Element('span', { 'data-state': 'round-status' });
  const app = fixture({ nodes: [timer, repeated, status] });
  await settle();
  assert.equal(timer.textContent, '30:00'); assert.equal(repeated.textContent, timer.textContent);
  app.advance(1000);
  assert.equal(timer.textContent, '29:59'); assert.equal(repeated.textContent, timer.textContent);
  app.advance(44000);
  assert.equal(app.latest().ready, false);
  assert.equal(timer.textContent, '—'); assert.equal(repeated.textContent, '—');
  assert.equal(app.latest().state.activatedAt, activation);
  app.response(liveState(activation + FIRST_ENTRY_MS));
  app.window.dispatchEvent(new Event('focus')); await settle();
  assert.equal(app.latest().ready, true);
  assert.equal(app.latest().schedule.current.id, 1);
  assert.equal(timer.textContent, '24:00:00');
});

test('Malformed or failed updates stop timer readiness while retaining the last verified launch', async () => {
  const timer = element('timer'), app = fixture({ nodes: [timer] });
  await settle();
  for (const bad of [new Error('Offline'), { ...liveState(), activatedAt: activation + 1 },
    { ...liveState(), serverNow: 'not-a-time' }, { ...liveState(), token: null },
    { ...liveState(), nextParticipants: '9' }, { ...liveState(), participants: -1 },
    { ...liveState(), next: { ...liveState().next, id: 99 } },
    { ...liveState(), myNextEntry: { address, roundId: 1, registeredAt: activation } }]) {
    app.response(bad); app.window.dispatchEvent(new Event('focus')); await settle();
    assert.equal(app.latest().ready, false);
    assert.equal(timer.textContent, '—');
    assert.equal(app.latest().state.activatedAt, activation);
  }
  app.response(liveState(activation + 2000)); app.window.dispatchEvent(new Event('focus')); await settle();
  assert.equal(app.latest().ready, true); assert.equal(timer.textContent, '29:58');
  app.response(liveState()); app.window.dispatchEvent(new Event('focus')); await settle();
  assert.equal(app.latest().ready, false, 'Older server snapshots cannot become fresh again');
});

test('A round boundary keeps the main clock running but waits for confirmed counts before emitting fresh state', async () => {
  const timer = element('timer'), count = element('traders');
  const before = { ...liveState(activation + FIRST_ENTRY_MS - 1), nextParticipants: 8 };
  const app = fixture({ nodes: [timer, count], state: before });
  await settle();
  assert.equal(count.textContent, '8');
  let release;
  app.response(new Promise(resolve => { release = resolve; }));
  app.advance(1);
  assert.equal(timer.textContent, '24:00:00');
  assert.equal(count.textContent, '—');
  assert.equal(app.latest().ready, false);
  assert.equal(app.latest().schedule.current.id, 1);
  release({ ...liveState(activation + FIRST_ENTRY_MS), participants: 9 });
  await settle();
  assert.equal(app.latest().ready, true);
  assert.equal(count.textContent, '9');
  assert.equal(app.latest().state.participants, 9);
});

test('Guide fallback content is replaced with real answers while existing static details are preserved', async () => {
  const faq = element('faq'), placeholder = new Element('p');
  placeholder.textContent = 'Enable JavaScript to load the current answers.';
  faq.append(placeholder);
  fixture({ nodes: [faq] }); await settle();
  assert.ok(faq.children.length > 1);
  assert.ok(faq.children.every(node => node.tagName === 'details'));
  assert.doesNotMatch(faq.textContent, /Enable JavaScript/);
  const existing = element('faq'), answer = new Element('details');
  answer.textContent = 'Existing published answer'; existing.append(answer);
  fixture({ nodes: [existing] }); await settle();
  assert.equal(existing.children.length, 1);
  assert.equal(existing.children[0], answer);
});

test('Cross-page continuity performs readonly account discovery and explicit disconnect removes only provider preference', async () => {
  const calls = [], provider = new EventEmitter();
  provider.request = async ({ method }) => {
    calls.push(method);
    if (method === 'eth_accounts') return [address];
    if (method === 'eth_chainId') return config.network.chainId;
    throw Error('Unexpected permission request');
  };
  const connect = element('connect', 'button'), participation = element('my-participation');
  const app = fixture({ nodes: [connect, participation], provider, preference: 'injected' });
  await settle();
  assert.equal(app.latest().wallet.address, address);
  assert.ok(app.requests.some(request => request.url.includes('?wallet=' + address)));
  assert.deepEqual(calls, ['eth_accounts', 'eth_chainId']);
  assert.equal(app.storage.get('arena:wallet-provider'), 'injected');
  assert.equal(app.storage.size, 1, 'Wallet address and account data are never persisted');
  connect.dispatchEvent(new Event('click')); await settle();
  assert.equal(app.latest().wallet.address, null);
  assert.equal(app.storage.size, 0);
  assert.equal(participation.textContent, 'Connect your wallet to view your entries.');
  assert.ok(app.requests.every(request => request.options.method === 'GET'));
});

test('An installed wallet without an explicit prior selection is never queried for accounts', async () => {
  const calls = [];
  const provider = { request: args => { calls.push(args.method); throw Error('Must not query an unselected wallet'); } };
  const app = fixture({ provider, nodes: [element('connect', 'button')] });
  await settle();
  assert.equal(app.latest().wallet.address, null);
  assert.equal(app.storage.size, 0);
  assert.deepEqual(calls, []);
});

test('Same-address wallet network changes cannot publish missing saved entries as fresh during resync', async () => {
  const provider = new EventEmitter();
  provider.request = async ({ method }) => method === 'eth_accounts' ? [address] : config.network.chainId;
  const nextEntry = element('my-next-entry');
  const app = fixture({ provider, preference: 'injected', nodes: [nextEntry] });
  await settle();
  assert.equal(app.latest().ready, true);
  let release;
  app.response(new Promise(resolve => { release = resolve; }));
  provider.emit('chainChanged', '0x1');
  assert.equal(app.latest().ready, false);
  assert.equal(nextEntry.textContent, 'Checking your saved entries…');
  release({ ...liveState(), nextParticipants: 1, myNextEntry: { address, roundId: 1, registeredAt: activation } });
  await settle();
  assert.equal(app.latest().ready, true);
  assert.equal(nextEntry.textContent, 'Registered for round #1');
});
