import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet } from 'ethers';
import { ArenaStore } from '../api/store.js';
import { ArenaService } from '../api/service.js';
import { createApiHandler } from '../api/http.js';
import { entryMessage } from '../dist/lib/entry-message.js';
import { FIRST_ENTRY_MS, ROUND_MS } from '../dist/lib/schedule.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const start = Date.UTC(2026, 8, 11, 12);
const origin = 'https://apex-round.com';
const oldToken = { address: '0x' + 'a'.repeat(40), chainId: 4663, decimals: 18, name: 'Apex', symbol: 'APEX' };
const newToken = { ...oldToken, address: '0x' + 'b'.repeat(40), name: 'Arena', symbol: 'ARENA' };
const balance = { balance: (10000000n * 10n ** 18n).toString(), block: '0x123', blockHash: '0x' + 'c'.repeat(64) };
const rejected = status => error => error.status === status;
const plain = rows => rows.map(row => ({ ...row }));

function database(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'arena-retirement-'));
  const filename = path.join(dir, 'arena.sqlite');
  const stores = [];
  const open = () => { const store = new ArenaStore(filename); stores.push(store); return store; };
  t.after(() => {
    for (const store of stores) { try { store.close(); } catch {} }
    rmSync(dir, { recursive: true, force: true });
  });
  return { dir, filename, open, store: open() };
}

function activeRows(store) {
  return {
    launch: plain(store.db.prepare('SELECT * FROM launch ORDER BY id').all()),
    entries: plain(store.db.prepare('SELECT * FROM entries ORDER BY round_id,address').all()),
    challenges: plain(store.db.prepare('SELECT * FROM challenges ORDER BY nonce').all()),
  };
}

function archivedRows(store) {
  return {
    launches: plain(store.db.prepare('SELECT * FROM retired_launches ORDER BY id').all()),
    entries: plain(store.db.prepare('SELECT * FROM retired_entries ORDER BY archive_id,round_id,address').all()),
    challenges: plain(store.db.prepare('SELECT * FROM retired_challenges ORDER BY archive_id,nonce').all()),
  };
}

async function requestFor(service, wallet) {
  const challenge = service.challenge({ address: wallet.address, roundId: 1 }, origin);
  return { challenge, request: { nonce: challenge.nonce, signature: await wallet.signMessage(challenge.message) } };
}

async function seedHistory(store) {
  store.activate(oldToken, start);
  // Existing records need not have the current JSON serializer's whitespace or key order.
  const rawToken = JSON.stringify({ symbol: oldToken.symbol, ...oldToken }, null, 3) + '\n';
  store.db.prepare('UPDATE launch SET token_json=? WHERE id=1').run(rawToken);
  const service = new ArenaService(store, { now: () => start + 1000, eligibility: async () => balance });
  const wallet = Wallet.createRandom();
  const accepted = await requestFor(service, wallet);
  await service.register(accepted.request, origin);
  const pending = await requestFor(service, Wallet.createRandom());
  const rawPending = JSON.stringify({ ...store.challenge(pending.challenge.nonce), auditNote: 'Сохранить точные байты \"ARENA\"' }, null, 2) + '\n';
  store.db.prepare('UPDATE challenges SET payload=? WHERE nonce=?').run(rawPending, pending.challenge.nonce);

  const legacyWallet = Wallet.createRandom();
  const legacy = { ...pending.challenge, nonce: 'd'.repeat(48), address: legacyWallet.address.toLowerCase() };
  delete legacy.messageVersion;
  delete legacy.message;
  const legacyMessage = entryMessage(legacy);
  assert.match(legacyMessage, /^APEX round registration\n/);
  const legacySignature = await legacyWallet.signMessage(legacyMessage);
  store.saveChallenge(legacy);
  store.db.prepare('UPDATE challenges SET used=1 WHERE nonce=?').run(legacy.nonce);
  store.db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)').run(1, legacy.address, start + 1000,
    balance.balance, balance.block, balance.blockHash, legacyMessage, legacySignature);
  return { service, wallet, pending, accepted, rawToken };
}

test('Retirement preserves exact launch, signed entries and raw challenge payloads across restart and repetition', async t => {
  const fixture = database(t);
  let store = fixture.store;
  const seeded = await seedHistory(store);
  const before = activeRows(store), retiredAt = start + 2000;
  const result = store.retire(oldToken.address, retiredAt);
  assert.equal(result.alreadyRetired, false);
  assert.ok(Number.isSafeInteger(result.archiveId) && result.archiveId > 0);
  assert.deepEqual(result.token, oldToken);
  assert.equal(result.activatedAt, start);
  assert.equal(result.retiredAt, retiredAt);
  assert.equal(result.entriesArchived, 2);
  assert.equal(result.challengesArchived, 3);
  assert.deepEqual(activeRows(store), { launch: [], entries: [], challenges: [] });
  assert.equal(store.launch(), null);
  assert.equal(store.challenge(seeded.pending.challenge.nonce), null);

  const archive = archivedRows(store);
  assert.deepEqual(archive.launches, [{ id: result.archiveId, token_address: oldToken.address,
    chain_id: oldToken.chainId, token_json: seeded.rawToken, activated_at: start, retired_at: retiredAt }]);
  assert.deepEqual(archive.entries, before.entries.map(row => ({ archive_id: result.archiveId, ...row })));
  assert.deepEqual(archive.challenges, before.challenges.map(row => ({ archive_id: result.archiveId, ...row })));

  store.close(); store = fixture.open();
  assert.equal(store.launch(), null);
  assert.deepEqual(archivedRows(store), archive);
  assert.deepEqual(store.retire(oldToken.address, retiredAt + ROUND_MS), { ...result, alreadyRetired: true });
  assert.deepEqual(archivedRows(store), archive);
  const state = new ArenaService(store, { now: () => retiredAt + ROUND_MS }).state(seeded.wallet.address.toLowerCase());
  assert.equal(state.phase, 'prelaunch');
  assert.equal(state.activatedAt, null);
  assert.equal(state.token, null);
  assert.equal(state.registration, null);
  assert.equal(state.participants, 0);
  assert.equal(state.nextParticipants, 0);
  assert.equal(state.myCurrentEntry, null);
  assert.equal(state.myNextEntry, null);
});

test('Expected-CA mismatch cannot retire the running launch or mutate any active or archived record', async t => {
  const { store } = database(t);
  await seedHistory(store);
  const active = activeRows(store), archive = archivedRows(store);
  assert.throws(() => store.retire(newToken.address, start + 2000), /different|match|expected/i);
  assert.deepEqual(activeRows(store), active);
  assert.deepEqual(archivedRows(store), archive);
});

test('Failure while archiving challenges rolls back the entire retirement including copied entries and launch', async t => {
  const { store } = database(t);
  await seedHistory(store);
  const active = activeRows(store), archive = archivedRows(store);
  store.db.exec(`CREATE TRIGGER fail_retirement BEFORE INSERT ON retired_challenges
    BEGIN SELECT RAISE(ABORT, 'simulated archive write failure'); END;`);
  assert.throws(() => store.retire(oldToken.address, start + 2000), /simulated archive write failure/);
  assert.deepEqual(activeRows(store), active);
  assert.deepEqual(archivedRows(store), archive);
  // A rolled-back operation must leave the connection usable for a subsequent complete retry.
  store.db.exec('DROP TRIGGER fail_retirement');
  assert.equal(store.retire(oldToken.address, start + 3000).entriesArchived, active.entries.length);
  assert.equal(store.launch(), null);
});

test('A new CA starts a clean two-hour round one; retired CA and prior signatures cannot revive old access', async t => {
  const { store } = database(t);
  const { pending, wallet } = await seedHistory(store);
  store.retire(oldToken.address, start + 2000);
  const archive = archivedRows(store), newStart = start + 5000;
  assert.throws(() => store.activate(oldToken, newStart), /retir|archiv/i);
  assert.equal(store.launch(), null);
  assert.deepEqual(store.activate(newToken, newStart), { token: newToken, activatedAt: newStart });
  const service = new ArenaService(store, { now: () => newStart, eligibility: async () => balance });
  const state = service.state(wallet.address.toLowerCase());
  assert.equal(state.phase, 'registration');
  assert.equal(state.next.id, 1);
  assert.equal(state.next.start - newStart, FIRST_ENTRY_MS);
  assert.equal(state.registration.open, true);
  assert.equal(state.registration.opensAt, newStart);
  assert.equal(state.registration.closesAt, newStart + FIRST_ENTRY_MS);
  assert.equal(state.nextParticipants, 0);
  assert.equal(state.myNextEntry, null);
  await assert.rejects(service.register(pending.request, origin), rejected(409));
  const fresh = await requestFor(service, wallet);
  assert.equal(fresh.challenge.tokenAddress, newToken.address);
  assert.equal(fresh.challenge.startsAt, newStart + FIRST_ENTRY_MS);
  await service.register(fresh.request, origin);
  assert.equal(store.count(1), 1);
  assert.deepEqual(archivedRows(store), archive);
  // Even an idempotent-looking invocation for an old CA must not touch a different active launch.
  const active = activeRows(store);
  assert.throws(() => store.retire(oldToken.address, newStart + 1000), /different|match|expected/i);
  assert.deepEqual(activeRows(store), active);
  assert.deepEqual(archivedRows(store), archive);
});

test('An eligibility request started under the retired launch cannot enter a new launch on another DB connection', async t => {
  const { store, open } = database(t);
  store.activate(oldToken, start);
  let now = start + 1000, finishEligibility, eligibilityStarted;
  const started = new Promise(resolve => { eligibilityStarted = resolve; });
  const pendingBalance = new Promise(resolve => { finishEligibility = resolve; });
  const service = new ArenaService(store, { now: () => now, eligibility: async token => {
    assert.deepEqual(token, oldToken);
    eligibilityStarted();
    return pendingBalance;
  } });
  const wallet = Wallet.createRandom(), request = (await requestFor(service, wallet)).request;
  const registration = service.register(request, origin);
  const rejectedRegistration = assert.rejects(registration, rejected(409));
  await started;
  const operator = open();
  operator.retire(oldToken.address, start + 2000);
  now = start + 3000;
  operator.activate(newToken, now);
  finishEligibility(balance);
  await rejectedRegistration;
  assert.deepEqual(store.launch(), { token: newToken, activatedAt: now });
  assert.equal(store.count(1), 0);
  assert.equal(store.entry(1, wallet.address.toLowerCase()), null);
  assert.equal(store.challenge(request.nonce), null);
  assert.equal(archivedRows(store).challenges[0].used, 0);
  assert.equal(archivedRows(store).entries.length, 0);
});

function cli(script, args, filename) {
  const result = spawnSync(process.execPath, ['--experimental-sqlite', path.join(root, 'api', script), ...args], {
    cwd: root, encoding: 'utf8', timeout: 5000, windowsHide: true,
    env: { ...process.env, APEX_DATABASE: filename, APEX_RPC_URL: 'http://127.0.0.1:1' },
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

test('Operator CLI validates exact arguments before opening a database', t => {
  const { dir } = database(t);
  for (const [index, args] of [[], [oldToken.address, newToken.address], ['not-a-contract'], ['0x' + '0'.repeat(40)],
    ['https://example.com/' + oldToken.address], [oldToken.address + ' extra']].entries()) {
    const filename = path.join(dir, 'invalid-' + index, 'arena.sqlite');
    const result = cli('retire.js', args, filename);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /usage|address|contract/i);
    assert.equal(existsSync(filename), false, 'Invalid input must not create a database');
  }
});

test('Operator CLI enforces the expected CA, persists retirement, and repeats without resetting archival time', t => {
  const { store, filename } = database(t);
  store.activate(oldToken, start);
  const active = activeRows(store);
  const mismatch = cli('retire.js', [newToken.address], filename);
  assert.equal(mismatch.status, 1);
  assert.match(mismatch.stderr, /different|match|expected/i);
  assert.deepEqual(activeRows(store), active);
  const first = cli('retire.js', [oldToken.address], filename);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(store.launch(), null);
  const archive = archivedRows(store);
  assert.equal(archive.launches.length, 1);
  const repeated = cli('retire.js', [oldToken.address], filename);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.deepEqual(archivedRows(store), archive);
  // A retired address is rejected locally, before any metadata/RPC inspection.
  const activation = cli('activate.js', [oldToken.address], filename);
  assert.equal(activation.status, 1);
  assert.match(activation.stderr, /retir|archiv/i);
  assert.equal(store.launch(), null);
  store.activate(newToken, start + ROUND_MS);
  const newActive = activeRows(store);
  assert.equal(cli('retire.js', [oldToken.address], filename).status, 1);
  assert.deepEqual(activeRows(store), newActive);
  assert.deepEqual(archivedRows(store), archive);
});

test('Public API exposes no retirement endpoint and cannot clear the active launch', async t => {
  const { store } = database(t);
  store.activate(oldToken, start);
  const service = new ArenaService(store, { now: () => start, eligibility: async () => balance });
  const server = http.createServer(createApiHandler(service, { origins: [origin] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await fetch(base + '/api/retire', { method, headers: { Origin: origin, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({ expectedAddress: oldToken.address }) } : {}) });
    assert.equal(response.status, 404);
    await response.text();
  }
  assert.deepEqual(store.launch(), { token: oldToken, activatedAt: start });
  assert.equal(archivedRows(store).launches.length, 0);
});
