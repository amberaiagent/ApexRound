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

const start = Date.UTC(2026, 8, 11, 12);
const origin = 'https://apex-round.com';
const token = { address: '0x3333333333333333333333333333333333333333', chainId: 4663, decimals: 18 };
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const required = 10000000n * 10n ** 18n;
const hash = '0x' + 'a'.repeat(64);
const balance = { balance: required.toString(), block: '0x123', blockHash: hash };
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

test('Shared schedule: 30-minute main timer, exact closure, 24-hour rollover and later entry hour', () => {
  assert.equal(scheduleAt(null, start).phase, 'prelaunch');
  const initial = scheduleAt(start, start);
  assert.equal(initial.registration.open, true);
  assert.equal(countdown(initial.next.start - start).slice(3), '30:00');
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
    if (fault) await assert.rejects(readEligibility(token, token.address, rpc, () => start), status(fault === 'short' ? 403 : 503));
    else {
      assert.deepEqual(await readEligibility(token, token.address, rpc, () => start), balance);
      assert.ok(calls.filter(c => ['eth_getCode', 'eth_call'].includes(c.method)).every(c => c.params[1] === '0x123'));
    }
  }
});

test('HTTP accepts the real signature flow, rejects other origins/large bodies and exposes no activation route', async t => {
  const { store, service } = fixture(t);
  const server = http.createServer(createApiHandler(service, { origins: [origin] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port;
  const post = (route, body, from = origin) => fetch(url + '/api/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body) });
  const state = await fetch(url + '/api/arena');
  assert.equal(state.headers.get('cache-control'), 'no-store');
  assert.equal((await state.json()).phase, 'prelaunch');
  assert.equal((await post('activate', { address: token.address })).status, 404);
  assert.equal((await post('entry/challenge', { address: token.address, roundId: 1 })).status, 409);
  assert.equal((await post('entry/challenge', {}, 'https://evil.example')).status, 403);
  assert.equal((await post('entry/challenge', { data: 'x'.repeat(9000) })).status, 413);
  assert.equal((await fetch(url + '/api/arena?wallet=no')).status, 400);
  store.activate(token, start);
  const wallet = Wallet.createRandom();
  const response = await post('entry/challenge', { address: wallet.address, roundId: 1 });
  assert.equal(response.status, 200);
  const challenge = await response.json();
  const accepted = await post('entry/register', { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) });
  assert.equal(accepted.status, 201);
  assert.equal((await accepted.json()).roundId, 1);
  assert.equal((await (await fetch(url + '/api/arena?wallet=' + wallet.address)).json()).myNextEntry.roundId, 1);
});
