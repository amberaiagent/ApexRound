import { FIRST_ENTRY_MS, ROUND_MS, NEXT_ENTRY_MS, scheduleAt } from './schedule.js';

const MAX_DATE = 8_640_000_000_000_000;
const filters = new Set(['all', 'live', 'upcoming', 'ended']);
const isTime = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_DATE;
const isCount = value => Number.isSafeInteger(value) && value >= 0;

export function parseRoundId(value) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : null;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function searchId(value) {
  const match = String(value ?? '').trim().match(/^(?:round\s*)?#?\s*(\d+)$/i);
  return match ? parseRoundId(match[1]) : null;
}

function bounds(activatedAt, id) {
  const start = activatedAt + FIRST_ENTRY_MS + (id - 1) * ROUND_MS;
  const end = start + ROUND_MS;
  if (!isTime(start) || !isTime(end)) return null;
  return { id, start, end };
}

function sameWindow(window, expected) {
  return !!window && !!expected && window.id === expected.id && window.start === expected.start && window.end === expected.end;
}

function context(snapshot) {
  const { state, schedule, ready } = snapshot ?? {};
  if (!ready || !state || !isTime(state.serverNow)) return { status: 'unavailable' };
  if (state.activatedAt === null) return { status: 'prelaunch' };
  if (!isTime(state.activatedAt)) return { status: 'unavailable' };
  const actual = scheduleAt(state.activatedAt, state.serverNow);
  const view = schedule ?? actual;
  let currentId = null;
  if (view.phase === 'registration') {
    if (view.current !== null || !sameWindow(view.next, bounds(state.activatedAt, 1))) return { status: 'unavailable' };
    if (actual.current) return { status: 'unavailable' };
  } else if (view.phase === 'live') {
    currentId = parseRoundId(view.current?.id);
    if (currentId === null || !sameWindow(view.current, bounds(state.activatedAt, currentId))
        || !sameWindow(view.next, bounds(state.activatedAt, currentId + 1))) return { status: 'unavailable' };
    // A fresh snapshot can cross one round boundary between API requests.
    if (currentId !== actual.current?.id && currentId !== actual.next?.id) return { status: 'unavailable' };
  } else return { status: 'unavailable' };
  const nextId = currentId === null ? 1 : currentId + 1;
  const next = bounds(state.activatedAt, nextId);
  const opensAt = nextId === 1 ? state.activatedAt : next.start - NEXT_ENTRY_MS;
  if (!view.registration || view.registration.roundId !== nextId
      || view.registration.opensAt !== opensAt || view.registration.closesAt !== next.start
      || typeof view.registration.open !== 'boolean') return { status: 'unavailable' };
  return { status: 'available', state, view, actual, currentId, maxId: nextId };
}

function roundFrom(ctx, id) {
  const dates = bounds(ctx.state.activatedAt, id);
  if (!dates || id > ctx.maxId) return null;
  const status = id === ctx.currentId ? 'live' : id === ctx.maxId ? 'upcoming' : 'ended';
  let participants = null;
  // Counts belong to named API windows, never to an index or a historical guess.
  if (status !== 'ended') {
    if (sameWindow(ctx.state.current, ctx.actual.current) && ctx.state.current.id === id && isCount(ctx.state.participants)) participants = ctx.state.participants;
    else if (sameWindow(ctx.state.next, ctx.actual.next) && ctx.state.next.id === id && isCount(ctx.state.nextParticipants)) participants = ctx.state.nextParticipants;
  }
  return {
    ...dates, status, participants,
    registration: {
      opensAt: id === 1 ? ctx.state.activatedAt : dates.start - NEXT_ENTRY_MS,
      closesAt: dates.start,
      open: status === 'upcoming' && ctx.view.registration.roundId === id && ctx.view.registration.open,
    },
    results: 'pending', payout: 'pending',
  };
}

export function roundDirectory(snapshot, options = {}) {
  const ctx = context(snapshot);
  const filter = filters.has(options.filter) ? options.filter : 'all';
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? Math.min(options.pageSize, 50) : 6;
  const empty = { status: ctx.status, filter, items: [], total: 0, pages: 0, page: 1, pageSize, hasPrevious: false, hasNext: false };
  if (ctx.status !== 'available') return empty;
  let first = 1, last = ctx.maxId;
  if (filter === 'live') { first = ctx.currentId ?? 1; last = ctx.currentId ?? 0; }
  if (filter === 'upcoming') first = last = ctx.maxId;
  if (filter === 'ended') last = ctx.currentId === null ? 0 : ctx.currentId - 1;
  if (String(options.query ?? '').trim()) {
    const id = searchId(options.query);
    if (id === null || id < first || id > last) return empty;
    first = last = id;
  }
  const total = Math.max(0, last - first + 1);
  if (!total) return empty;
  const pages = Math.ceil(total / pageSize);
  const requestedPage = Number.isSafeInteger(options.page) && options.page > 0 ? options.page : 1;
  const page = Math.min(requestedPage, pages);
  const top = last - (page - 1) * pageSize;
  const bottom = Math.max(first, top - pageSize + 1);
  const items = [];
  // Only the visible page is materialized, even after years of daily rounds.
  for (let id = top; id >= bottom; id--) items.push(roundFrom(ctx, id));
  return { ...empty, items, total, pages, page, hasPrevious: page > 1, hasNext: page < pages };
}

export function roundDetail(snapshot, value) {
  const id = parseRoundId(value);
  if (id === null) return { status: 'invalid', round: null };
  const ctx = context(snapshot);
  if (ctx.status !== 'available') return { status: ctx.status, round: null };
  const round = id <= ctx.maxId ? roundFrom(ctx, id) : null;
  return { status: round ? 'available' : 'not-found', round };
}
