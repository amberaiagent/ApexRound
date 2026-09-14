import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, cp, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import vm from 'node:vm';
import { roundDirectory, roundDetail } from '../dist/lib/round-directory.js';
import { scheduleAt, FIRST_ENTRY_MS, ROUND_MS } from '../dist/lib/schedule.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = ['/', '/arena/', '/rounds/', '/rounds/view/', '/my-arena/', '/guide/', '/token/', '/rules/'];
const pages = new Map();
const execute = promisify(execFile);
let temporary;
const outputFile = (directory, route) => path.join(directory, 'dist', route, 'index.html');

before(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), 'arena-site-test-'));
  await cp(path.join(root, 'site'), path.join(temporary, 'site'), { recursive: true });
  await mkdir(path.join(temporary, 'scripts'));
  await cp(path.join(root, 'scripts/build-site.mjs'), path.join(temporary, 'scripts/build-site.mjs'));
  await execute(process.execPath, [path.join(temporary, 'scripts/build-site.mjs')], { cwd: temporary });
  for (const route of routes) pages.set(route, await readFile(outputFile(temporary, route), 'utf8'));
});
after(async () => {
  if (temporary && path.dirname(temporary) === path.resolve(os.tmpdir()) && path.basename(temporary).startsWith('arena-site-test-')) {
    await rm(temporary, { recursive: true, force: true });
  }
});

function attributes(source) {
  const values = {};
  for (const match of source.matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    values[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return values;
}
function elements(html, name) {
  return [...html.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi)]
    .map(match => ({ tag: match[1].toLowerCase(), attrs: attributes(match[2]), index: match.index, end: match.index + match[0].length }))
    .filter(element => !name || element.tag === name);
}
const visibleText = html => html.replace(/<[^>]*>/g, '').replace(/&(?:nbsp|#160);/g, ' ').trim();
const ids = html => new Set(elements(html).filter(element => element.attrs.id).map(element => element.attrs.id));

test('Eight page outputs are deterministic and match the generated files committed with the site', async () => {
  await execute(process.execPath, [path.join(temporary, 'scripts/build-site.mjs')], { cwd: temporary });
  const titles = new Set();
  for (const [route, html] of pages) {
    assert.equal(await readFile(outputFile(temporary, route), 'utf8'), html, 'A second build changed ' + route);
    assert.equal(await readFile(outputFile(root, route), 'utf8'), html, 'Rebuild generated page ' + route);
    assert.doesNotMatch(html, /\{\{\w+\}\}/, 'Unresolved template in ' + route);
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    assert.ok(title && !titles.has(title), 'Missing or duplicate page title at ' + route);
    titles.add(title);
    const canonical = elements(html, 'link').find(element => element.attrs.rel === 'canonical');
    assert.equal(canonical?.attrs.href, 'https://apex-round.com' + route);
    assert.ok(elements(html, 'meta').some(element => element.attrs.name === 'description' && element.attrs.content.length > 30));
  }
});

test('Internal navigation, fragments, assets and browser module imports resolve from every nested route', async () => {
  const scripts = new Set();
  for (const [route, html] of pages) {
    for (const element of elements(html)) {
      for (const attribute of ['href', 'src']) {
        const reference = element.attrs[attribute];
        if (!reference || /^(?:data:|mailto:|tel:)/i.test(reference)) continue;
        const url = new URL(reference, 'https://apex-round.com' + route);
        if (url.origin !== 'https://apex-round.com') continue;
        if (element.tag === 'link' && element.attrs.rel === 'canonical') continue;
        if (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
          const destination = url.pathname.replace(/index\.html$/, '');
          assert.ok(pages.has(destination), `Missing internal route ${reference} on ${route}`);
          if (url.hash) assert.ok(ids(pages.get(destination)).has(decodeURIComponent(url.hash.slice(1))), `Missing anchor ${reference} on ${route}`);
        } else {
          const asset = path.resolve(root, 'dist', '.' + url.pathname);
          assert.ok(asset.startsWith(path.join(root, 'dist') + path.sep), 'Asset escaped dist');
          assert.ok((await stat(asset)).isFile(), `Missing asset ${reference} on ${route}`);
          if (element.tag === 'script') scripts.add(asset);
        }
      }
      if (element.tag === 'script') assert.equal(element.attrs.type, 'module', 'Scripts must preserve deferred module loading');
    }
  }
  const visited = new Set();
  async function checkImports(filename) {
    if (visited.has(filename)) return;
    visited.add(filename);
    const source = await readFile(filename, 'utf8');
    for (const match of source.matchAll(/\b(?:from\s*|import\s*)['"]([^'"]+)['"]/g)) {
      const imported = match[1];
      if (!imported.startsWith('.')) continue;
      const target = path.resolve(path.dirname(filename), imported.split(/[?#]/)[0]);
      assert.ok((await stat(target)).isFile(), `Missing browser import ${imported} from ${filename}`);
      await checkImports(target);
    }
  }
  await Promise.all([...scripts].map(checkImports));
});

test('Pages have unique IDs, one main heading, named controls and working accessibility references', () => {
  for (const [route, html] of pages) {
    const all = elements(html), pageIds = ids(html);
    assert.equal(pageIds.size, all.filter(element => element.attrs.id).length, 'Duplicate IDs on ' + route);
    assert.equal(elements(html, 'main').length, 1, 'Missing or duplicate main region on ' + route);
    assert.equal(elements(html, 'h1').length, 1, 'Missing or duplicate h1 on ' + route);
    assert.equal(elements(html, 'html')[0]?.attrs.lang, 'en');
    assert.ok(elements(html, 'a').some(element => element.attrs.class === 'skip-link' && element.attrs.href === '#main'));
    for (const element of all) {
      for (const attribute of ['aria-labelledby', 'aria-describedby', 'aria-controls']) {
        for (const id of (element.attrs[attribute] ?? '').split(/\s+/).filter(Boolean)) assert.ok(pageIds.has(id), `Broken ${attribute}=${id} on ${route}`);
      }
      if (element.tag === 'img') assert.ok(Object.hasOwn(element.attrs, 'alt'), 'Image missing alt on ' + route);
      if (element.tag === 'svg') assert.ok(element.attrs['aria-hidden'] === 'true' || element.attrs['aria-label'] || element.attrs['aria-labelledby'], 'Unnamed SVG on ' + route);
      if (element.tag === 'button') {
        const close = html.indexOf('</button>', element.end);
        assert.ok(element.attrs['aria-label'] || element.attrs['aria-labelledby'] || visibleText(html.slice(element.end, close)), 'Unnamed button on ' + route);
      }
      if (element.tag === 'input' && element.attrs.type !== 'hidden') {
        const prefix = html.slice(0, element.index);
        const wrapped = prefix.lastIndexOf('<label') > prefix.lastIndexOf('</label>');
        const explicit = all.some(label => label.tag === 'label' && label.attrs.for === element.attrs.id);
        assert.ok(wrapped || explicit || element.attrs['aria-label'] || element.attrs['aria-labelledby'], 'Unlabelled input on ' + route);
      }
    }
    assert.ok(all.some(element => element.tag === 'dialog' && element.attrs['aria-labelledby'] === 'wallet-title'));
  }
});

test('Directory routes include their complete runtime controls without duplicating registration forms', () => {
  const directory = pages.get('/rounds/'), detail = pages.get('/rounds/view/');
  for (const id of ['round-list', 'round-search', 'round-pagination', 'round-prev', 'round-next', 'round-page-label']) assert.ok(ids(directory).has(id), id);
  assert.deepEqual(elements(directory, 'button').filter(element => element.attrs['data-round-filter']).map(element => element.attrs['data-round-filter']), ['all', 'live', 'upcoming', 'ended']);
  assert.ok(ids(detail).has('round-detail'));
  for (const html of [directory, detail]) assert.equal(elements(html, 'script').filter(element => element.attrs.src?.startsWith('/rounds.js?')).length, 1);
  for (const [route, html] of pages) {
    assert.equal(ids(html).has('entry-content'), route === '/arena/' || route === '/my-arena/', 'Entry form on wrong page: ' + route);
  }
});

class Element extends EventTarget {
  constructor(tag = 'div', attrs = {}) {
    super();
    this.tagName = tag; this.attrs = attrs; this.dataset = {};
    if (attrs['data-round-filter']) this.dataset.roundFilter = attrs['data-round-filter'];
    this.children = []; this.value = ''; this._text = ''; this.className = '';
    this.classList = { toggle() {} };
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  set innerHTML(value) { throw Error('Directory HTML must be constructed using safe DOM methods'); }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this._text = ''; this.children = children; }
}
const runtimeSource = (await readFile(path.join(root, 'dist/rounds.js'), 'utf8')).replace(/^import .+;\r?\n/gm, '');
const activation = Date.UTC(2026, 8, 10, 12);
function liveSnapshot() {
  const now = activation + FIRST_ENTRY_MS + 12 * ROUND_MS;
  const schedule = scheduleAt(activation, now);
  return { ready: true, state: { activatedAt: activation, serverNow: now, ...schedule, participants: 5, nextParticipants: 2 }, schedule };
}
function runtime({ detail = false, query = '', eager = false } = {}) {
  const elementIds = detail ? ['round-detail'] : ['round-list', 'round-search', 'round-count', 'round-pagination', 'round-prev', 'round-next', 'round-page-label'];
  const nodes = new Map(elementIds.map(id => [id, new Element('div', { id })]));
  const filters = detail ? [] : ['all', 'live', 'upcoming', 'ended'].map(value => new Element('button', { 'data-round-filter': value }));
  const window = new EventTarget();
  let requests = 0;
  const state = liveSnapshot();
  window.addEventListener('arena:state-request', () => {
    requests++;
    if (eager) window.dispatchEvent(new CustomEvent('arena:state', { detail: state }));
  });
  const context = vm.createContext({
    roundDirectory, roundDetail, window, location: { search: query }, URLSearchParams, CustomEvent,
    document: {
      querySelector: selector => nodes.get(selector.slice(1)) ?? null,
      querySelectorAll: selector => selector === '[data-round-filter]' ? filters : [],
      createElement: tag => new Element(tag),
    },
  });
  vm.runInContext(runtimeSource, context, { filename: 'rounds.js' });
  return { nodes, filters, requests, send: value => window.dispatchEvent(new CustomEvent('arena:state', { detail: value ?? state })) };
}

test('Round pages receive state whether the shared app loads before or after the directory module', () => {
  for (const eager of [false, true]) {
    const page = runtime({ eager });
    assert.equal(page.requests, 1);
    if (!eager) {
      assert.match(page.nodes.get('round-list').textContent, /updates unavailable/i);
      page.send();
    }
    assert.equal(page.nodes.get('round-list').children.length, 6);
    assert.match(page.nodes.get('round-list').textContent, /Round #014/);
    assert.equal(page.nodes.get('round-pagination').hidden, false);
    page.nodes.get('round-next').dispatchEvent(new Event('click'));
    assert.match(page.nodes.get('round-list').textContent, /Round #008/);
    page.filters.find(button => button.dataset.roundFilter === 'live').dispatchEvent(new Event('click'));
    assert.equal(page.nodes.get('round-list').children.length, 1);
    assert.match(page.nodes.get('round-list').textContent, /Round #013/);
    assert.equal(page.nodes.get('round-pagination').hidden, true);
    page.send({ ...liveSnapshot(), ready: false });
    assert.match(page.nodes.get('round-list').textContent, /updates unavailable/i);
    assert.doesNotMatch(page.nodes.get('round-list').textContent, /confirmed registrations/);
  }
});

test('Detail routes handle duplicate/invalid query IDs and expose only real scheduled facts', () => {
  for (const query of ['', '?round=1&round=2', '?round=%3Cscript%3E', '?round=-1']) {
    const page = runtime({ detail: true, query, eager: true });
    assert.match(page.nodes.get('round-detail').textContent, /valid round/i);
  }
  const page = runtime({ detail: true, query: '?round=1', eager: true });
  const detail = page.nodes.get('round-detail');
  assert.match(detail.textContent, /Round #001/);
  assert.match(detail.textContent, /30 minutes/);
  assert.match(detail.textContent, /Results and payouts are pending/);
  assert.match(detail.textContent, /Historical registration counts are not available/);
  const actions = detail.children.at(-1).children;
  assert.deepEqual(Array.from(actions, item => item.href), ['/arena/', '/my-arena/', '/rounds/']);
  for (const action of actions) assert.ok(pages.has(action.href));
});
