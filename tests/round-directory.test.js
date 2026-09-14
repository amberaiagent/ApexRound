import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FIRST_ENTRY_MS, ROUND_MS, NEXT_ENTRY_MS, scheduleAt } from '../dist/lib/schedule.js';
import { parseRoundId, roundDirectory, roundDetail } from '../dist/lib/round-directory.js';

const activatedAt = Date.parse('2026-09-10T23:34:42.002Z');
const firstStart = activatedAt + FIRST_ENTRY_MS;
function snapshot(now, options = {}) {
  const schedule = scheduleAt(activatedAt, now);
  return {
    ready: true,
    state: { activatedAt, serverNow: now, ...schedule, participants: 7, nextParticipants: 3 },
    schedule,
    ...options,
  };
}

test('First registration and exact trading boundaries use the shared server schedule', () => {
  const first = roundDirectory(snapshot(activatedAt));
  assert.equal(first.total, 1);
  assert.equal(first.items[0].status, 'upcoming');
  assert.equal(first.items[0].registration.open, true);
  assert.equal(first.items[0].registration.opensAt, activatedAt);
  assert.equal(first.items[0].registration.closesAt, firstStart);
  assert.equal(first.items[0].participants, 3);
  assert.equal(roundDirectory(snapshot(firstStart - 1)).items[0].status, 'upcoming');
  const started = roundDirectory(snapshot(firstStart));
  assert.deepEqual(started.items.map(({id, status}) => [id, status]), [[2, 'upcoming'], [1, 'live']]);
  assert.equal(started.items[1].registration.open, false);
  assert.equal(started.items[0].registration.opensAt, firstStart + ROUND_MS - NEXT_ENTRY_MS);
  assert.equal(started.items[0].registration.open, false);
  assert.equal(roundDirectory(snapshot(firstStart + ROUND_MS - NEXT_ENTRY_MS)).items[0].registration.open, true);
  const rolled = roundDirectory(snapshot(firstStart + ROUND_MS));
  assert.deepEqual(rolled.items.map(({id, status}) => [id, status]), [[3, 'upcoming'], [2, 'live'], [1, 'ended']]);
});

test('Status filters, exact round search and descending pagination work together', () => {
  const data = snapshot(firstStart + 12 * ROUND_MS);
  const first = roundDirectory(data);
  assert.equal(first.total, 14);
  assert.equal(first.pages, 3);
  assert.deepEqual(first.items.map(item => item.id), [14, 13, 12, 11, 10, 9]);
  assert.equal(first.hasPrevious, false);
  assert.equal(first.hasNext, true);
  const last = roundDirectory(data, { page: 99 });
  assert.equal(last.page, 3);
  assert.deepEqual(last.items.map(item => item.id), [2, 1]);
  assert.equal(last.hasNext, false);
  assert.deepEqual(roundDirectory(data, { filter: 'live' }).items.map(item => item.id), [13]);
  assert.deepEqual(roundDirectory(data, { filter: 'upcoming' }).items.map(item => item.id), [14]);
  assert.equal(roundDirectory(data, { filter: 'ended' }).total, 12);
  assert.equal(roundDirectory(data, { filter: 'ended', query: 'Round #0012' }).items[0].id, 12);
  assert.equal(roundDirectory(data, { filter: 'ended', query: '14' }).total, 0);
  assert.equal(roundDirectory(data, { query: '<script>' }).total, 0);
  assert.equal(roundDirectory(data, { query: '2.5' }).total, 0);
  assert.equal(roundDirectory(data, { query: '999' }).total, 0);
  assert.equal(roundDirectory(snapshot(activatedAt), { filter: 'live' }).total, 0);
  assert.equal(roundDirectory(snapshot(activatedAt), { filter: 'ended' }).total, 0);
});

test('Large elapsed schedules materialize only the requested page', () => {
  const result = roundDirectory(snapshot(firstStart + 1_000_000 * ROUND_MS), { page: 125_000 });
  assert.equal(result.total, 1_000_002);
  assert.equal(result.items.length, 6);
  assert.equal(result.items[0].id, 250_008);
});

test('Detail rejects malformed, unsafe and not-yet-scheduled IDs', () => {
  const data = snapshot(firstStart);
  for (const id of [undefined, null, '', '0', '-1', '+1', '1.5', '1e2', ' 1 ', 'Round 1', '9007199254740992', NaN, Infinity, 1.5]) {
    assert.equal(parseRoundId(id), null, String(id));
    assert.equal(roundDetail(data, id).status, 'invalid', String(id));
  }
  assert.equal(parseRoundId('001'), 1);
  assert.equal(roundDetail(data, '001').round.id, 1);
  assert.equal(roundDetail(data, '3').status, 'not-found');
  assert.equal(roundDetail(data, Number.MAX_SAFE_INTEGER).status, 'not-found');
});

test('Unavailable/stale data and prelaunch are distinct and never expose live counts', () => {
  const data = snapshot(firstStart);
  for (const value of [null, { ...data, ready: false }, { ...data, state: null }, { ...data, state: { ...data.state, serverNow: NaN } }]) {
    assert.equal(roundDirectory(value).status, 'unavailable');
    assert.deepEqual(roundDirectory(value).items, []);
    assert.equal(roundDetail(value, 1).status, 'unavailable');
  }
  const prelaunch = { ready: true, state: { activatedAt: null, serverNow: activatedAt }, schedule: scheduleAt(null, activatedAt) };
  assert.equal(roundDirectory(prelaunch).status, 'prelaunch');
  assert.equal(roundDetail(prelaunch, 1).status, 'prelaunch');
  assert.equal(roundDirectory({ ...prelaunch, ready: false }).status, 'unavailable');
  const malformed = { ...data, schedule: { ...data.schedule, current: { ...data.schedule.current, start: firstStart + 1 } } };
  assert.equal(roundDirectory(malformed).status, 'unavailable');
});

test('Only counts attached to actual current/next API windows are shown', () => {
  const data = snapshot(firstStart + ROUND_MS);
  assert.equal(roundDetail(data, 1).round.participants, null);
  assert.equal(roundDetail(data, 2).round.participants, 7);
  assert.equal(roundDetail(data, 3).round.participants, 3);
  const beforeBoundary = snapshot(firstStart + ROUND_MS - 1);
  beforeBoundary.schedule = scheduleAt(activatedAt, firstStart + ROUND_MS);
  assert.equal(roundDetail(beforeBoundary, 1).round.participants, null);
  assert.equal(roundDetail(beforeBoundary, 2).round.participants, 3);
  assert.equal(roundDetail(beforeBoundary, 3).round.participants, null);
  const noCounts = { ...data, state: { ...data.state, participants: undefined, nextParticipants: -1 } };
  assert.equal(roundDetail(noCounts, 2).round.participants, null);
  assert.equal(roundDetail(noCounts, 3).round.participants, null);
  const zero = { ...data, state: { ...data.state, participants: 0 } };
  assert.equal(roundDetail(zero, 2).round.participants, 0);
  const wrongWindow = { ...data, state: { ...data.state, current: { ...data.state.current, id: 1 } } };
  assert.equal(roundDetail(wrongWindow, 2).round.participants, null);
});

test('Ended details expose schedule facts without fabricated results or payouts', () => {
  const round = roundDetail(snapshot(firstStart + 2 * ROUND_MS), 1).round;
  assert.equal(round.start, firstStart);
  assert.equal(round.end, firstStart + ROUND_MS);
  assert.equal(round.status, 'ended');
  assert.equal(round.results, 'pending');
  assert.equal(round.payout, 'pending');
  assert.equal(round.participants, null);
  assert.equal('winners' in round, false);
});
