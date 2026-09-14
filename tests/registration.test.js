import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { ArenaStore } from '../api/store.js';
import { ArenaService, readEligibility } from '../api/service.js';
import { createApiHandler } from '../api/http.js';
import { scheduleAt, countdown, FIRST_ENTRY_MS, ROUND_MS } from '../dist/lib/schedule.js';
import { entryMessage, ENTRY_MESSAGE_VERSION } from '../dist/lib/entry-message.js';
import { BrowserWallet } from '../dist/lib/wallet.js';
import { config } from '../dist/lib/config.js';

const start = Date.UTC(2026, 8, 11, 12);
const origin = 'https://arenarounds.xyz';
const token = { address: '0x3333333333333333333333333333333333333333', chainId: 4663, decimals: 18 };
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const required = 5000000n * 10n ** 18n;
const hash = '0x' + 'a'.repeat(64);
const balance = { balance: required.toString(), block: '0x123', blockHash: hash };
function balanceRpc(value) {
  return async (method, params) => {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') return { number: '0x123', hash, timestamp: '0x' + BigInt(start / 1000).toString(16) };
    if (method === 'eth_getCode') return '0x6080';
    if (method === 'eth_call') return params[0].data === '0x313ce567' ? word(18) : word(value());
    throw Error('Unexpected RPC: ' + method);
  };
}
const status = expected => error => error.status === expected;
function fixture(t, options = {}) {
  const store = new ArenaStore(':memory:'); t.after(() => store.close());
  let now = start;
  const service = new ArenaService(store, { now: () => now, eligibility: async () => balance, ...options });
  return { store, service, setTime: value => { now = value; } };
}
async function signed(service, wallet, roundId = 1) {
  const challenge = service.challenge({ address: wallet.address, roundId }, origin);
  return { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) };
}

test('Shared schedule: two-hour main timer, exact closure, 24-hour rollover and later entry hour', () => {
  assert.equal(scheduleAt(null, start).phase, 'prelaunch');
  const initial = scheduleAt(start, start);
  assert.equal(initial.registration.open, true);
  assert.equal(countdown(initial.next.start - start), '02:00:00');
  assert.equal(scheduleAt(start, start + FIRST_ENTRY_MS - 1).registration.open, true);
  const first = scheduleAt(start, start + FIRST_ENTRY_MS);
  assert.equal(first.phase, 'live'); assert.equal(first.current.id, 1);
  assert.equal(first.registration.open, false);
  assert.equal(countdown(first.current.end - first.current.start), '24:00:00');
  assert.equal(scheduleAt(start, first.current.end - 3600001).registration.open, false);
  assert.equal(scheduleAt(start, first.current.end - 3600000).registration.open, true);
  const second = scheduleAt(start, first.current.end);
  assert.equal(second.current.id, 2); assert.equal(second.registration.open, false);
  assert.equal(second.current.end - second.current.start, ROUND_MS);
  assert.equal(scheduleAt(start, first.current.start + 400 * ROUND_MS).current.id, 401);
});

test('Activation and signed entries survive database restart; repeating the CA never resets the timer', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-registration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'arena.sqlite');
  let store = new ArenaStore(filename);
  try {
    store.activate(token, start);
    const service = new ArenaService(store, { now: () => start + 1000, eligibility: async () => balance });
    const wallet = Wallet.createRandom();
    const receipt = await service.register(await signed(service, wallet), origin);
    assert.equal(receipt.roundId, 1);
    store.close(); store = new ArenaStore(filename);
    assert.equal(store.launch().activatedAt, start);
    assert.equal(store.activate(token, start + 900000).activatedAt, start);
    assert.equal(store.entry(1, wallet.address.toLowerCase()).registeredAt, start + 1000);
    assert.equal(store.count(1), 1);
    assert.throws(() => store.activate({ ...token, address: '0x' + '4'.repeat(40) }, start), /different token/);
  } finally { store.close(); }
});

test('No entry before CA activation; no public record is invented by checking status', t => {
  const { service } = fixture(t);
  assert.equal(service.state().activatedAt, null);
  assert.equal(service.state().participants, 0);
  assert.throws(() => service.challenge({ address: token.address, roundId: 1 }, origin), status(409));
});

test('Valid entry is durable, cannot be replayed and is not carried over to the next round', async t => {
  const { store, service, setTime } = fixture(t); store.activate(token, start);
  const wallet = Wallet.createRandom(), address = wallet.address.toLowerCase();
  const request = await signed(service, wallet);
  await service.register(request, origin);
  assert.equal(service.state(address).nextParticipants, 1);
  assert.equal(service.state(address).myNextEntry.roundId, 1);
  await assert.rejects(service.register(request, origin), status(409));
  assert.throws(() => service.challenge({ address, roundId: 1 }, origin), status(409));
  setTime(start + FIRST_ENTRY_MS);
  assert.equal(service.state(address).participants, 1);
  assert.equal(service.state(address).myCurrentEntry.roundId, 1);
  assert.equal(service.state(address).myNextEntry, null);
  assert.equal(service.state(address).pool, null);
  setTime(start + FIRST_ENTRY_MS + ROUND_MS - 3600000);
  await service.register(await signed(service, wallet, 2), origin);
  assert.equal(store.count(2), 1);
});

test('Wrong signer, origin, tampered message and expired nonce are rejected', async t => {
  const { store, service, setTime } = fixture(t); store.activate(token, start);
  const wallet = Wallet.createRandom(), other = Wallet.createRandom();
  const challenge = service.challenge({ address: wallet.address, roundId: 1 }, origin);
  await assert.rejects(service.register({ nonce: challenge.nonce, signature: await other.signMessage(challenge.message) }, origin), status(401));
  await assert.rejects(service.register({ nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message + 'tampered') }, origin), status(401));
  const request = { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) };
  await assert.rejects(service.register(request, 'https://other.example'), status(409));
  setTime(start + 300000);
  await assert.rejects(service.register(request, origin), status(409));
  assert.equal(store.count(1), 0);
});

test('Server rejects entry when balance verification crosses the registration deadline', async t => {
  let setTime;
  const f = fixture(t, { eligibility: async () => { setTime(start + FIRST_ENTRY_MS); return balance; } });
  setTime = f.setTime; f.store.activate(token, start); setTime(start + FIRST_ENTRY_MS - 1000);
  await assert.rejects(f.service.register(await signed(f.service, Wallet.createRandom()), origin), status(409));
  assert.equal(f.store.count(1), 0);
});

test('Concurrent signed requests for one wallet accept exactly one entry', async t => {
  const { store, service } = fixture(t); store.activate(token, start);
  const wallet = Wallet.createRandom();
  const requests = [await signed(service, wallet), await signed(service, wallet)];
  const outcomes = await Promise.allSettled(requests.map(request => service.register(request, origin)));
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(store.count(1), 1);
});

test('New ARENA challenge version is persisted and only its exact text can be registered', async t => {
  const { store, service } = fixture(t); store.activate(token, start);
  const wallet = Wallet.createRandom();
  const challenge = service.challenge({ address: wallet.address, roundId: 1 }, origin);
  assert.equal(challenge.messageVersion, 3);
  assert.equal(challenge.messageVersion, ENTRY_MESSAGE_VERSION);
  assert.equal(store.challenge(challenge.nonce).messageVersion, 3);
  assert.match(challenge.message, /^ARENA round registration\n/);
  assert.match(challenge.message, /\nRequired balance: 5000000 ARENA tokens\n/);
  assert.doesNotMatch(challenge.message, /APEX/);
  const legacyText = entryMessage({ ...challenge, messageVersion: 1 });
  await assert.rejects(service.register({
    nonce: challenge.nonce, messageVersion: 1, signature: await wallet.signMessage(legacyText),
  }, origin), status(401));
  const signature = await wallet.signMessage(challenge.message);
  // Client version fields cannot replace the version already bound to this nonce.
  await service.register({ nonce: challenge.nonce, messageVersion: 1, signature }, origin);
  const saved = store.db.prepare('SELECT message, signature FROM entries WHERE round_id=1 AND address=?')
    .get(wallet.address.toLowerCase());
  assert.equal(saved.message, challenge.message);
  assert.equal(saved.signature, signature);
  assert.deepEqual(store.launch(), { token, activatedAt: start });
});

test('Unversioned legacy signatures remain valid after restart without rewriting prior entries or launch data', async t => {
  const origin = 'https://apex-round.com';
  const dir = mkdtempSync(path.join(tmpdir(), 'apex-message-compatibility-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'arena.sqlite');
  let store = new ArenaStore(filename);
  try {
    store.activate(token, start + 30 * 60 * 1000 - FIRST_ENTRY_MS);
    const wallet = Wallet.createRandom(), address = wallet.address.toLowerCase();
    const legacy = {
      nonce: 'b'.repeat(48), address, roundId: 1, origin, chainId: token.chainId,
      tokenAddress: token.address, startsAt: start + 30 * 60 * 1000,
      endsAt: start + 30 * 60 * 1000 + ROUND_MS, issuedAt: start, expiresAt: start + 300000,
    };
    // Frozen previous-release format: compatibility must preserve every byte.
    const oldMessage = [
      'APEX round registration', 'Website: ' + origin, 'Wallet: ' + address,
      'Network: Robinhood Chain (4663)', 'Round: #1',
      'Trading starts: 2026-09-11T12:30:00.000Z', 'Trading ends: 2026-09-12T12:30:00.000Z',
      'Access token: ' + token.address, 'Required balance: 10000000 APEX tokens',
      'Register this wallet for this round only. This does not authorize a payment, token approval or transfer.',
      'Nonce: ' + legacy.nonce, 'Issued at: 2026-09-11T12:00:00.000Z',
      'Expires at: 2026-09-11T12:05:00.000Z',
    ].join('\n');
    assert.equal(entryMessage(legacy), oldMessage);
    store.saveChallenge(legacy);
    const priorAddress = Wallet.createRandom().address.toLowerCase();
    store.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)').run(1, priorAddress,
      start, balance.balance, balance.block, balance.blockHash, 'prior signed bytes', 'prior signature');
    const oldSignature = await wallet.signMessage(oldMessage);
    store.close(); store = new ArenaStore(filename);
    assert.equal(store.challenge(legacy.nonce).messageVersion, undefined);
    const service = new ArenaService(store, { now: () => start + 1000, eligibility: async () => balance });
    // Rebranding a legacy payload is not permission to accept different signed text.
    const changedText = entryMessage({ ...legacy, messageVersion: 2 });
    await assert.rejects(service.register({ nonce: legacy.nonce, messageVersion: 2,
      signature: await wallet.signMessage(changedText) }, origin), status(401));
    await service.register({ nonce: legacy.nonce, signature: oldSignature }, origin);
    await assert.rejects(service.register({ nonce: legacy.nonce, signature: oldSignature }, origin), status(409));
    const accepted = store.db.prepare('SELECT message, signature FROM entries WHERE address=?').get(address);
    assert.equal(accepted.message, oldMessage);
    assert.equal(accepted.signature, oldSignature);
    const prior = store.db.prepare('SELECT message, signature FROM entries WHERE address=?').get(priorAddress);
    assert.equal(prior.message, 'prior signed bytes');
    assert.equal(prior.signature, 'prior signature');
    assert.deepEqual(store.launch(), { token, activatedAt: start + 30 * 60 * 1000 - FIRST_ENTRY_MS });
    assert.equal(store.count(1), 2);
  } finally { store.close(); }
});

test('Browser validates both legacy and ARENA messages but never signs a version/text mismatch or unknown version', async t => {
  const { store, service } = fixture(t); store.activate(token, start);
  const signer = Wallet.createRandom(), address = signer.address.toLowerCase(), signedMessages = [];
  const provider = { request: async ({ method, params }) => {
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [address];
    if (method === 'eth_chainId') return config.network.chainId;
    if (method === 'personal_sign') {
      const message = Buffer.from(params[0].slice(2), 'hex').toString('utf8');
      signedMessages.push(message);
      return signer.signMessage(message);
    }
    throw Error('Unexpected RPC method: ' + method);
  } };
  const browser = new BrowserWallet();
  await browser.connect(provider); t.after(() => browser.disconnect());
  const challenge = service.challenge({ address, roundId: 1 }, origin);
  const settings = { ...config, tokenAddress: token.address, decimals: token.decimals, targetRoundId: 1 };
  const legacy = { ...challenge }; delete legacy.messageVersion;
  legacy.message = entryMessage(legacy);
  const priorArena = { ...challenge, messageVersion: 2 };
  priorArena.message = entryMessage(priorArena);
  await browser.signEntry(legacy, settings, origin);
  await browser.signEntry(priorArena, settings, origin);
  const signature = await browser.signEntry(challenge, settings, origin);
  assert.deepEqual(signedMessages, [legacy.message, priorArena.message, challenge.message]);
  for (const altered of [
    { ...challenge, messageVersion: 1 }, { ...challenge, messageVersion: 2 },
    { ...legacy, messageVersion: 2 }, { ...priorArena, messageVersion: 3 },
    ...[null, 0, 4, '3', true].map(messageVersion => ({ ...challenge, messageVersion })),
  ]) await assert.rejects(browser.signEntry(altered, settings, origin), /details changed|Unsupported registration message version/);
  assert.equal(signedMessages.length, 3);
  await service.register({ nonce: challenge.nonce, signature }, origin);
  assert.equal(store.count(1), 1);
});

test('The 5M upgrade preserves persisted v2 signed bytes and enforces their original 10M requirement', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'arena-threshold-compatibility-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'arena.sqlite');
  const wallet = Wallet.createRandom(), address = wallet.address.toLowerCase();
  const previous = {
    messageVersion: 2, nonce: 'e'.repeat(48), address, roundId: 1,
    origin, chainId: token.chainId, tokenAddress: token.address,
    startsAt: start + 30 * 60 * 1000, endsAt: start + 30 * 60 * 1000 + ROUND_MS,
    issuedAt: start, expiresAt: start + 300000,
  };
  const message = [
    'ARENA round registration', 'Website: ' + origin, 'Wallet: ' + address,
    'Network: Robinhood Chain (4663)', 'Round: #1',
    'Trading starts: 2026-09-11T12:30:00.000Z', 'Trading ends: 2026-09-12T12:30:00.000Z',
    'Access token: ' + token.address, 'Required balance: 10000000 ARENA tokens',
    'Register this wallet for this round only. This does not authorize a payment, token approval or transfer.',
    'Nonce: ' + previous.nonce, 'Issued at: 2026-09-11T12:00:00.000Z',
    'Expires at: 2026-09-11T12:05:00.000Z',
  ].join('\n');
  const signature = await wallet.signMessage(message);
  const rawPayload = JSON.stringify(previous, null, 2) + '\n';
  let store = new ArenaStore(filename);
  try {
    store.activate(token, start + 30 * 60 * 1000 - FIRST_ENTRY_MS);
    store.saveChallenge(previous);
    store.db.prepare('UPDATE challenges SET payload=? WHERE nonce=?').run(rawPayload, previous.nonce);
    const priorWallet = Wallet.createRandom(), priorAddress = priorWallet.address.toLowerCase();
    const priorMessage = message.replace('Wallet: ' + address, 'Wallet: ' + priorAddress);
    const priorSignature = await priorWallet.signMessage(priorMessage);
    store.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)').run(1, priorAddress,
      start, (10000000n * 10n ** 18n).toString(), balance.block, balance.blockHash, priorMessage, priorSignature);
    const prior = store.db.prepare('SELECT * FROM entries WHERE address=?').get(priorAddress);
    store.close(); store = new ArenaStore(filename);
    assert.equal(entryMessage(store.challenge(previous.nonce)), message);
    let availableBalance = required;
    const service = new ArenaService(store, { now: () => start + 1000, rpc: balanceRpc(() => availableBalance) });
    const request = { nonce: previous.nonce, signature, messageVersion: 3 };
    await assert.rejects(service.register(request, origin), error => error.status === 403 && /10,000,000/.test(error.message));
    availableBalance = 10000000n * 10n ** 18n - 1n;
    await assert.rejects(service.register(request, origin), status(403));
    assert.equal(store.challenge(previous.nonce).used, false);
    assert.equal(store.db.prepare('SELECT payload FROM challenges WHERE nonce=?').get(previous.nonce).payload, rawPayload);
    availableBalance++;
    await service.register(request, origin);
    const accepted = store.db.prepare('SELECT message,signature FROM entries WHERE address=?').get(address);
    assert.equal(accepted.message, message);
    assert.equal(accepted.signature, signature);
    assert.equal(store.db.prepare('SELECT payload FROM challenges WHERE nonce=?').get(previous.nonce).payload, rawPayload);
    assert.deepEqual(store.db.prepare('SELECT * FROM entries WHERE address=?').get(priorAddress), prior);
    assert.deepEqual(store.launch(), { token, activatedAt: start + 30 * 60 * 1000 - FIRST_ENTRY_MS });
  } finally { store.close(); }
});

test('Trusted balance verification enforces exact threshold and rejects bad chain, stale blocks and reorgs', async () => {
  for (const fault of [null, 'short', 'chain', 'stale', 'future', 'reorg', 'code', 'decimals']) {
    const calls = [];
    const rpc = async (method, params) => {
      calls.push({ method, params });
      if (method === 'eth_chainId') return fault === 'chain' ? '0x1' : '0x1237';
      if (method === 'eth_getBlockByNumber') return { number: '0x123', hash: fault === 'reorg' && params[0] !== 'latest' ? '0x' + 'b'.repeat(64) : hash, timestamp: '0x' + BigInt(start / 1000 + (fault === 'stale' ? -301 : fault === 'future' ? 121 : 0)).toString(16) };
      if (method === 'eth_getCode') return fault === 'code' ? '0x' : '0x6080';
      if (method === 'eth_call') return params[0].data === '0x313ce567' ? word(fault === 'decimals' ? 6 : 18) : word(required - (fault === 'short' ? 1n : 0n));
      throw Error('Unexpected RPC');
    };
    if (fault) await assert.rejects(readEligibility(token, token.address, rpc, () => start), error => {
      assert.equal(error.status, fault === 'short' ? 403 : 503);
      if (fault === 'short') {
        assert.match(error.message, /5,000,000 \$ARENA/);
        assert.doesNotMatch(error.message, /APEX/);
      }
      return true;
    });
    else {
      assert.deepEqual(await readEligibility(token, token.address, rpc, () => start), balance);
      assert.ok(calls.filter(c => ['eth_getCode', 'eth_call'].includes(c.method)).every(c => c.params[1] === '0x123'));
    }
  }
});

test('Default HTTP origin accepts new-domain signatures, rejects old-domain replay and exposes no activation route', async t => {
  const { store, service } = fixture(t);
  const server = http.createServer(createApiHandler(service));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, from = origin) => fetch(url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body) });
  const state = await fetch(url + '/api/arena');
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.equal((await state.json()).phase, 'prelaunch');
  assert.equal((await post('activate', { address: token.address })).status, 404);
  assert.equal((await post('entry/challenge', { address: token.address, roundId: 1 })).status, 409);
  for (const otherOrigin of ['https://apex-round.com', 'https://www.arenarounds.xyz', 'http://arenarounds.xyz', 'https://evil.example']) {
    assert.equal((await post('entry/challenge', {}, otherOrigin)).status, 403);
  }
  assert.equal((await post('entry/challenge', { data: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(url + '/api/arena?wallet=no')).status, 400);
  store.activate(token, start);
  const wallet = Wallet.createRandom();
  // A still-unexpired challenge issued before a domain move cannot be replayed
  // on the new origin, nor may its signed bytes be silently rewritten.
  const previous = service.challenge({ address: wallet.address, roundId: 1 }, 'https://apex-round.com');
  const previousRequest = { nonce: previous.nonce, signature: await wallet.signMessage(previous.message) };
  assert.equal((await post('entry/register', previousRequest)).status, 409);
  assert.equal((await post('entry/register', previousRequest, previous.origin)).status, 403);
  assert.equal(store.challenge(previous.nonce).origin, previous.origin);
  assert.equal(store.challenge(previous.nonce).used, false);
  assert.equal(store.count(1), 0);
  const response = await post('entry/challenge', { address: wallet.address, roundId: 1 });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.equal(challenge.origin, origin);
  assert.ok(challenge.message.includes('\nWebsite: ' + origin + '\n'));
  const changedOriginSignature = await wallet.signMessage(entryMessage({ ...challenge, origin: previous.origin }));
  assert.equal((await post('entry/register', { nonce: challenge.nonce, signature: changedOriginSignature })).status, 401);
  const accepted = await post('entry/register', { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).roundId, 1);
  assert.equal((await (await fetch(url + '/api/arena?wallet=' + wallet.address)).json()).myNextEntry.roundId, 1);
});

test('Signed HTTP entry rejects 5M minus one atomic unit and accepts exactly 5M without consuming a failed nonce', async t => {
  let availableBalance = required;
  const { store, service } = fixture(t, { eligibility: undefined, rpc: balanceRpc(() => availableBalance) });
  store.activate(token, start);
  const server = http.createServer(createApiHandler(service, { origins: [origin] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body) => fetch(url + '/api/entry/' + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  const wallet = Wallet.createRandom();
  const response = await post('challenge', { address: wallet.address, roundId: 1 });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  assert.equal(challenge.messageVersion, 3);
  assert.ok(challenge.message.includes('\nRequired balance: 5000000 ARENA tokens\n'));
  const request = { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) };
  availableBalance = required - 1n;
  const short = await post('register', request);
  assert.equal(short.status, 403);
  assert.match((await short.json()).error, /5,000,000 \$ARENA/);
  assert.equal(store.count(1), 0);
  assert.equal(store.challenge(challenge.nonce).used, false);
  availableBalance = required;
  const accepted = await post('register', request);
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).roundId, 1);
  assert.equal(store.db.prepare('SELECT balance FROM entries WHERE address=?').get(wallet.address.toLowerCase()).balance, required.toString());
  assert.equal((await (await fetch(url + '/api/arena?wallet=' + wallet.address)).json()).myNextEntry.roundId, 1);
});
