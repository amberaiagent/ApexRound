import { roundDirectory, roundDetail } from './lib/round-directory.js';

const list = document.querySelector('#round-list');
const detail = document.querySelector('#round-detail');
const search = document.querySelector('#round-search');
const filterButtons = [...document.querySelectorAll('[data-round-filter]')];
const pagination = document.querySelector('#round-pagination');
const previous = document.querySelector('#round-prev');
const next = document.querySelector('#round-next');
const pageLabel = document.querySelector('#round-page-label');
const count = document.querySelector('#round-count');
let snapshot = null, filter = 'all', page = 1, lastRender = '';
const dateFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const date = value => dateFormat.format(value);
const number = value => '#' + String(value).padStart(3, '0');

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function link(label, href, className = 'text-link') {
  const element = node('a', label, className);
  element.href = href;
  return element;
}

function statusLabel(round) {
  return round.status === 'live' ? 'Live' : round.status === 'ended' ? 'Ended' : round.registration.open ? 'Registration open' : 'Upcoming';
}

function empty(title, message) {
  const block = node('div', undefined, 'empty-state');
  block.append(node('h3', title), node('p', message));
  return block;
}

function row(round) {
  const article = node('article', undefined, 'round-row');
  const heading = node('h3', 'Round ' + number(round.id), 'round-row-number');
  const meta = node('div', undefined, 'round-row-meta');
  meta.append(node('p', date(round.start) + ' — ' + date(round.end)));
  meta.append(node('p', round.participants === null ? 'Registration count unavailable' : round.participants.toLocaleString('en-US') + ' confirmed registrations'));
  const status = node('div', undefined, 'round-row-status');
  status.append(node('span', statusLabel(round), 'status-tag ' + round.status));
  status.append(node('p', round.status === 'ended' ? 'Results pending' : '24-hour round'));
  const action = node('div', undefined, 'round-row-action');
  const open = link('View round', '/rounds/view/?round=' + round.id);
  open.setAttribute('aria-label', 'View round ' + round.id);
  action.append(open);
  article.append(heading, meta, status, action);
  return article;
}

function renderDirectory() {
  if (!list) return;
  if (!snapshot || (!snapshot.state && !snapshot.error)) {
    if (lastRender !== 'loading') list.replaceChildren(empty('Loading rounds…', 'Checking the official arena schedule.'));
    lastRender = 'loading';
    return;
  }
  const result = roundDirectory(snapshot, { filter, page, query: search?.value });
  page = result.page;
  const key = JSON.stringify(result);
  if (key === lastRender) return;
  lastRender = key;
  list.replaceChildren();
  for (const button of filterButtons) {
    const selected = button.dataset.roundFilter === filter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  if (result.status === 'unavailable') list.append(empty('Round updates unavailable', 'We cannot verify the arena schedule right now. This page will reconnect automatically.'));
  else if (result.status === 'prelaunch') list.append(empty('The first round is ahead.', 'Rounds will appear when the official token is activated. The first registration period lasts 30 minutes.'));
  else if (!result.items.length) list.append(empty('No rounds found.', search?.value.trim() ? 'Try another round number or choose a different status.' : 'There are no rounds with this status yet.'));
  else list.append(...result.items.map(row));
  if (count) count.textContent = result.status !== 'available' ? '—' : result.total.toLocaleString('en-US') + (result.total === 1 ? ' round' : ' rounds');
  if (pagination) pagination.hidden = result.pages <= 1;
  if (previous) previous.disabled = !result.hasPrevious;
  if (next) next.disabled = !result.hasNext;
  if (pageLabel) pageLabel.textContent = result.pages ? 'Page ' + result.page + ' of ' + result.pages : '';
}

function metric(label, value, explanation) {
  const card = node('section', undefined, 'detail-card');
  card.append(node('h3', label), node('p', value, 'detail-metric'));
  if (explanation) card.append(node('p', explanation));
  return card;
}

function renderDetail() {
  if (!detail) return;
  if (!snapshot || (!snapshot.state && !snapshot.error)) {
    if (lastRender !== 'loading') detail.replaceChildren(empty('Loading this round…', 'Checking the official arena schedule.'));
    lastRender = 'loading';
    return;
  }
  const params = new URLSearchParams(location.search);
  const id = params.getAll('round').length === 1 ? params.get('round') : null;
  const result = roundDetail(snapshot, id);
  const key = JSON.stringify(result);
  if (key === lastRender) return;
  lastRender = key;
  detail.replaceChildren();
  if (result.status !== 'available') {
    const copy = {
      invalid: ['Choose a valid round.', 'This link does not contain a valid round number.'],
      'not-found': ['This round is not scheduled yet.', 'The directory contains completed rounds, the current round and the next scheduled round.'],
      unavailable: ['Round updates unavailable', 'We cannot verify this round right now. This page will reconnect automatically.'],
      prelaunch: ['The first round is ahead.', 'The schedule begins when the official token is activated. No rounds have started yet.'],
    }[result.status];
    const block = empty(...copy);
    block.append(link('Browse rounds', '/rounds/', 'outline'));
    detail.append(block);
    return;
  }
  const { round } = result;
  const header = node('div', undefined, 'detail-heading');
  header.append(node('span', statusLabel(round), 'status-tag ' + round.status));
  header.append(node('h2', 'Round ' + number(round.id)));
  header.append(node('p', date(round.start) + ' — ' + date(round.end)));
  const grid = node('div', undefined, 'detail-grid');
  grid.append(
    metric('Trading window', '24 hours', 'Starts ' + date(round.start) + '. Ends ' + date(round.end) + '.'),
    metric('Confirmed registrations', round.participants === null ? 'Unavailable' : round.participants.toLocaleString('en-US'), round.participants === null ? (round.status === 'ended' ? 'Historical registration counts are not available from the current arena feed.' : 'This round’s registration count is not available from the latest arena update.') : 'Confirmed by the latest arena update.'),
    metric('Registration', round.id === 1 ? '30 minutes' : '1 hour', 'Opens ' + date(round.registration.opensAt) + '. Closes ' + date(round.registration.closesAt) + '.'),
    metric('Access requirement', '5M $ARENA', 'Connect your wallet, verify your balance and register before the round starts.'),
  );
  const notice = node('section', undefined, 'notice');
  notice.append(node('h3', 'Results and payouts are pending.'), node('p', 'Verified portfolio returns, rankings, winners and payout records are not available yet. A round ending does not mean its results or rewards have been finalized.'));
  const actions = node('div', undefined, 'detail-actions');
  actions.append(link(round.registration.open ? 'Register for this round' : round.status === 'live' ? 'Open the live arena' : 'Open the arena', '/arena/', 'primary'));
  actions.append(link('My arena', '/my-arena/', 'outline'), link('All rounds', '/rounds/'));
  detail.append(header, grid, notice, actions);
}

for (const button of filterButtons) button.addEventListener('click', () => {
  filter = button.dataset.roundFilter;
  page = 1;
  renderDirectory();
});
search?.addEventListener('input', () => { page = 1; renderDirectory(); });
previous?.addEventListener('click', () => { page = Math.max(1, page - 1); renderDirectory(); });
next?.addEventListener('click', () => { page += 1; renderDirectory(); });
window.addEventListener('arena:state', event => {
  snapshot = event.detail;
  renderDirectory();
  renderDetail();
});
renderDirectory();
renderDetail();
window.dispatchEvent(new CustomEvent('arena:state-request'));
