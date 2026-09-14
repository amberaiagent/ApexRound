import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { ArenaStore } from '../api/store.js';
import { ArenaService } from '../api/service.js';
import { entryMessage } from '../dist/lib/entry-message.js';
import { countdown, FIRST_ENTRY_MS, NEXT_ENTRY_MS, ROUND_MS, scheduleAt } from '../dist/lib/schedule.js';

const activatedAt = 1789420257927;
const oldWindow = 30 * 60 * 1000;
const extendedWindow = 2 * 60 * 60 * 1000;
const origin = 'https://arenarounds.xyz';
const token = { address: '0x3333333333333333333333333333333333333333', chainId: 4663, decimals: 18 };
const balance = { balance: (5000000n * 10n ** 18n).toString(), block: '0x123', blockHash: '0x' + 'a'.repeat(64) };

test('First registration closes two hours after original activation, not two hours after the extension', () => {
  assert.equal(FIRST_ENTRY_MS, extendedWindow);
  const firstStart = activatedAt + extendedWindow;
  assert.equal(firstStart, 1789427457927);
  assert.equal(countdown(firstStart - activatedAt), '02:00:00');
  for (const now of [activatedAt, activatedAt + oldWindow, firstStart - 1]) {
    const state = scheduleAt(activatedAt, now);
    assert.equal(state.phase, 'registration');
    assert.equal(state.current, null);
    assert.equal(state.registration.open, true);
    assert.equal(state.registration.opensAt, activatedAt);
    assert.equal(state.registration.closesAt, firstStart);
    assert.deepEqual(state.next, { id: 1, start: firstStart, end: firstStart + ROUND_MS });
  }
  const live = scheduleAt(activatedAt, firstStart);
  assert.equal(live.phase, 'live');
  assert.equal(live.current.id, 1);
  assert.equal(live.current.end - live.current.start, 86400000);
  assert.equal(live.registration.open, false);
  assert.equal(NEXT_ENTRY_MS, 3600000);
  assert.equal(scheduleAt(activatedAt, live.current.end - NEXT_ENTRY_MS - 1).registration.open, false);
  assert.equal(scheduleAt(activatedAt, live.current.end - NEXT_ENTRY_MS).registration.open, true);
  assert.equal(scheduleAt(activatedAt, live.current.end).current.id, 2);
});

test('An unexpired 30-minute challenge is rejected after extension without rewriting persisted signed bytes', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'arena-registration-extension-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'arena.sqlite');
  const wallet = Wallet.createRandom(), priorWallet = Wallet.createRandom();
  const issuedAt = activatedAt + 20 * 60 * 1000;
  const now = issuedAt + 60000;
  const old = {
    messageVersion: 3, nonce: 'd'.repeat(48), address: wallet.address.toLowerCase(),
    roundId: 1, origin, chainId: token.chainId, tokenAddress: token.address,
    startsAt: activatedAt + oldWindow, endsAt: activatedAt + oldWindow + ROUND_MS,
    issuedAt, expiresAt: issuedAt + 300000,
  };
  const oldMessage = entryMessage(old), oldSignature = await wallet.signMessage(oldMessage);
  const priorMessage = entryMessage({ ...old, nonce: 'e'.repeat(48), address: priorWallet.address.toLowerCase() });
  const priorSignature = await priorWallet.signMessage(priorMessage);
  let store = new ArenaStore(filename);
  try {
    store.activate(token, activatedAt);
    store.saveChallenge(old);
    // Seed an exact previous-release record, using the existing entries schema.
    store.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)').run(1,
      priorWallet.address.toLowerCase(), issuedAt, balance.balance, balance.block,
      balance.blockHash, priorMessage, priorSignature);
    const oldRow = store.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(old.nonce);
    const priorRow = store.db.prepare('SELECT * FROM entries WHERE address=?').get(priorWallet.address.toLowerCase());
    const originalLaunch = store.launch();
    store.close();
    store = new ArenaStore(filename);
    let eligibilityCalls = 0;
    const service = new ArenaService(store, { now: () => now, eligibility: async () => {
      eligibilityCalls++;
      return balance;
    } });
    assert.equal(service.state().registration.open, true);
    assert.ok(old.expiresAt > now, 'The old challenge is still within its original expiry.');
    await assert.rejects(service.register({ nonce: old.nonce, signature: oldSignature }, origin),
      error => error.status === 409 && /Request a new entry/.test(error.message));
    assert.equal(eligibilityCalls, 0);
    assert.equal(store.entry(1, old.address), null);
    assert.deepEqual(store.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(old.nonce), oldRow);
    assert.deepEqual(store.db.prepare('SELECT * FROM entries WHERE address=?').get(priorWallet.address.toLowerCase()), priorRow);
    assert.equal(entryMessage(store.challenge(old.nonce)), oldMessage);
    assert.deepEqual(store.launch(), originalLaunch);

    const fresh = service.challenge({ address: wallet.address, roundId: 1 }, origin);
    assert.equal(fresh.startsAt, activatedAt + extendedWindow);
    assert.equal(fresh.endsAt, fresh.startsAt + ROUND_MS);
    await assert.rejects(service.register({ nonce: fresh.nonce, signature: oldSignature }, origin),
      error => error.status === 401);
    await service.register({ nonce: fresh.nonce, signature: await wallet.signMessage(fresh.message) }, origin);
    assert.equal(eligibilityCalls, 1);
    assert.equal(store.count(1), 2);
    assert.deepEqual(store.db.prepare('SELECT * FROM entries WHERE address=?').get(priorWallet.address.toLowerCase()), priorRow);
    assert.deepEqual(store.db.prepare('SELECT * FROM challenges WHERE nonce=?').get(old.nonce), oldRow);
    assert.equal(store.launch().activatedAt, activatedAt);
  } finally { store.close(); }
});
