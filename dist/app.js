import { config, pending } from './lib/config.js?v=arena-token-20260914';
import { BrowserWallet, WalletDiscovery, walletError, formatTokens } from './lib/wallet.js?v=arena-pages-20260914';
import { scheduleAt, countdown } from './lib/schedule.js';

const $ = selector => document.querySelector(selector);
const stateNodes = id => document.querySelectorAll('#' + id + ', [data-state="' + id + '"]');
function stateText(id, value) {
  for (const node of stateNodes(id)) if (node.textContent !== String(value)) node.textContent = String(value);
}
const short = address => address.slice(0, 6) + '…' + address.slice(-4);
const when = time => new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(time) + ' / ' + new Date(time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' local';
let busy = '', message = '', snapshot = null, toastTimer;
let arena = null, arenaAddress = null, settings = {...config,tokenAddress:null,decimals:null}, syncedAt = 0, serverBase = 0, syncError = '', requestId = 0, entryKey = '', boundaryRequestKey = '';
const providerPreferenceKey = 'arena:wallet-provider';
let providerPreference = null, resumeFinished = false;
try { providerPreference = localStorage.getItem(providerPreferenceKey); } catch { /* Storage is optional. */ }
const wallet = new BrowserWallet(() => {
  snapshot = null;
  message = '';
  arenaAddress = undefined;
  if (arena) arena = {...arena,myCurrentEntry:null,myNextEntry:null};
  renderEntry();
  renderArena();
  refreshArena();
});
const discovery = new WalletDiscovery(window, () => { renderWallets(); tryResume(); });

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = content;
  if (className) node.className = className;
  return node;
}
function button(label, action, className = 'primary') {
  const node = text('button', label, className);
  node.type = 'button';
  node.disabled = !!busy;
  node.addEventListener('click', action);
  return node;
}
function toast(content) {
  clearTimeout(toastTimer);
  const node = $('#toast');
  if (!node) return;
  node.textContent = content;
  node.style.display = 'block';
  toastTimer = setTimeout(() => { node.style.display = 'none'; }, 5000);
}
function clockFresh() { return !!arena && !syncError && performance.now() - syncedAt < 45000; }
function matchesSnapshot(schedule) {
  return !!arena && arena.phase === schedule.phase
    && (arena.current?.id ?? null) === (schedule.current?.id ?? null)
    && (arena.next?.id ?? null) === (schedule.next?.id ?? null);
}
function fresh() { return clockFresh() && arenaAddress === wallet.address && matchesSnapshot(view()); }
function serverNow() { return Math.floor(serverBase + performance.now() - syncedAt); }
function view() { return scheduleAt(arena?.activatedAt ?? null, arena ? serverNow() : 0); }
function publishState() {
  // Give page modules a read-only snapshot; they cannot mutate the registration state.
  window.dispatchEvent(new CustomEvent('arena:state', { detail: {
    state: arena ? structuredClone(arena) : null, schedule: view(), ready: fresh(),
    error: syncError || null,
    wallet: { address: wallet.address, chainId: wallet.chainId },
  } }));
}
function targetEntry(schedule) {
  return [arena?.myNextEntry,arena?.myCurrentEntry].find(entry => entry?.roundId === schedule.next?.id) ?? null;
}
async function api(path, body) {
  const response = await fetch('/api/' + path, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: body ? {'Content-Type':'application/json'} : {},
    ...(body ? {body:JSON.stringify(body)} : {}),
    signal: AbortSignal.timeout(body ? 60000 : 12000),
  });
  let data;
  try { data = await response.json(); } catch { throw Error('Arena updates are unavailable. Please try again.'); }
  if (!response.ok) throw Error(data.error || 'The registration service is unavailable.');
  return data;
}
async function refreshArena() {
  const id = ++requestId, address = wallet.address, started = performance.now();
  try {
    const data = await api('arena' + (address ? '?wallet=' + encodeURIComponent(address) : ''));
    if (id !== requestId || address !== wallet.address) return;
    const validTime = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 - 172800000;
    if (!validTime(data.serverNow) || !(data.activatedAt === null || validTime(data.activatedAt) && data.activatedAt <= data.serverNow)) throw Error('Invalid arena timing. Please refresh.');
    if (data.token && (!/^0x[0-9a-f]{40}$/i.test(data.token.address) || data.token.chainId !== 4663 || !Number.isInteger(data.token.decimals) || data.token.decimals < 0 || data.token.decimals > 255)) throw Error('Token configuration is unavailable.');
    if (!!data.token !== (data.activatedAt !== null)) throw Error('Arena configuration is unavailable.');
    const expected = scheduleAt(data.activatedAt, data.serverNow);
    const sameRound = (actual, target) => target === null ? actual === null : actual?.id === target.id && actual.start === target.start && actual.end === target.end;
    if (data.phase !== expected.phase || !sameRound(data.current, expected.current) || !sameRound(data.next, expected.next)
      || (expected.registration === null ? data.registration !== null : ['roundId', 'opensAt', 'closesAt', 'open'].some(key => data.registration?.[key] !== expected.registration[key]))
      || ![data.participants, data.nextParticipants].every(count => Number.isSafeInteger(count) && count >= 0)) throw Error('Arena round data is inconsistent.');
    for (const [field, round] of [['myCurrentEntry', expected.current], ['myNextEntry', expected.next]]) {
      const entry = data[field];
      if (entry !== null && (!address || !round || entry?.roundId !== round.id || entry.address !== address || !validTime(entry.registeredAt) || entry.registeredAt > data.serverNow)) throw Error('Wallet entry data is inconsistent.');
    }
    if (arena && data.serverNow < arena.serverNow) throw Error('Arena updates are out of order.');
    const previousToken = settings.tokenAddress;
    arena = data;
    arenaAddress = address;
    settings = {...config,tokenAddress:data.token?.address ?? null,decimals:data.token?.decimals ?? null};
    if (previousToken !== settings.tokenAddress) snapshot = null;
    syncedAt = performance.now();
    serverBase = data.serverNow + (syncedAt - started) / 2;
    syncError = '';
  } catch (error) {
    if (id !== requestId) return;
    syncError = 'Arena updates are unavailable. Entry is paused until the connection returns.';
  }
  renderArena();
  renderEntry();
}
function renderArena() {
  const schedule = view(), ready = fresh(), registration = schedule.registration;
  const first = schedule.phase === 'registration';
  const roundKey = [schedule.phase, schedule.current?.id, schedule.next?.id].join(':');
  if (arena && !matchesSnapshot(schedule) && roundKey !== boundaryRequestKey) {
    boundaryRequestKey = roundKey;
    refreshArena();
  }
  const end = first ? schedule.next.start : schedule.current?.end;
  // The same main timer counts 30 minutes before round 1 and 24 hours during trading.
  const remaining = clockFresh() && end ? countdown(end - serverNow()) : '—';
  const count = first ? arena?.nextParticipants : arena?.current?.id === schedule.current?.id ? arena?.participants : arena?.next?.id === schedule.current?.id ? arena?.nextParticipants : 0;
  const values = {
    'round-status': !ready ? (syncError ? '◇ UPDATES UNAVAILABLE' : '◇ CONNECTING') : first ? '● REGISTRATION OPEN' : schedule.current ? '● LIVE ROUND' : '◇ AWAITING LAUNCH',
    'launch-badge': !ready ? (syncError ? 'Updates unavailable' : 'Connecting') : first ? 'Registration open' : schedule.current ? 'Daily rounds' : 'Coming soon',
    'round-label': first ? 'UPCOMING ROUND' : 'CURRENT ROUND',
    'round-number': first ? '#001' : schedule.current ? '#' + String(schedule.current.id).padStart(3,'0') : 'Not started',
    'round-dates': schedule.current ? when(schedule.current.start) : first ? when(schedule.next.start) : 'First round to be announced',
    'timer-label': first ? 'REGISTRATION CLOSES IN' : schedule.current ? 'ROUND ENDS IN' : 'FIRST ROUND STARTS',
    'timer': first && remaining !== '—' ? remaining.slice(3) : remaining,
    'timer-note': !ready && arena ? 'Synchronizing with the arena' : first ? 'Round #1 starts when this reaches zero' : schedule.current ? '24-hour trading round' : '30-minute first entry window',
    'launch-label': first ? 'REGISTRATION IS OPEN' : schedule.current ? 'THE ROUND IS LIVE' : 'THE FIRST ROUND',
    'launch-note': syncError || (first ? 'Hold 10M $ARENA, check your balance and register before the main timer reaches zero. Everyone starts together.' : schedule.current ? 'Registration for this round is closed. The next round opens for entries in the final hour. Portfolio results are not connected yet.' : 'When the official $ARENA token is activated, the main timer starts at 30:00 and registration opens. At zero, the first 24-hour round begins.'),
    'traders-label': first ? 'REGISTERED FOR ROUND #1' : 'TRADERS IN THE ARENA',
    'traders': ready ? String(count ?? 0) : '—',
    'traders-note': first ? 'Confirmed registrations' : schedule.current ? 'Return data pending' : 'Registration has not opened',
    'pool': '—',
    'board-status': !ready ? 'Waiting for arena updates' : schedule.current ? 'Awaiting portfolio data' : first ? 'Registration in progress' : 'Awaiting first round',
    'board-message': $('#search')?.value.trim() ? 'No verified results to search yet.' : schedule.current ? 'Trading results are not available yet.' : 'Verified results will appear after trading begins.',
    'next-label': schedule.next ? (first ? 'FIRST ROUND #1' : 'NEXT ROUND #' + schedule.next.id) : 'FIRST ROUND',
    'next-number': schedule.next ? '#' + String(schedule.next.id).padStart(3, '0') : 'Not started',
    'next-status': !ready ? 'Checking registration status' : registration?.open ? 'Registration open' : 'Registration not open',
    'next-start': schedule.next ? (registration.open ? 'Starts ' : 'Entry opens ' + when(registration.opensAt) + '. Starts ') + when(schedule.next.start) + '.' : 'Starts 30 minutes after the official token is activated.',
  };
  if (!arena) Object.assign(values, {
    'round-label':'ROUND', 'round-number':'—', 'round-dates':'Confirming the official schedule',
    'timer-label':'ROUND COUNTDOWN', 'timer-note':'Synchronizing with the arena',
    'launch-label':'ROUND SCHEDULE', 'launch-note':syncError || 'Connecting to the official arena schedule.',
    'traders-label':'CONFIRMED ENTRIES', 'traders-note':'Checking registrations',
    'board-message':'Waiting for the current round status.', 'next-label':'NEXT ROUND',
    'next-number':'—', 'next-start':'Confirming the next registration window.',
  });
  for (const [id, value] of Object.entries(values)) stateText(id, value);
  for (const node of stateNodes('round-status')) node.classList.toggle('awaiting', !ready || schedule.phase === 'prelaunch');
  renderParticipation(schedule);
  const key = [schedule.phase,schedule.current?.id,schedule.next?.id,registration?.open,ready].join(':');
  if (key !== entryKey) { entryKey = key; renderEntry(); }
  publishState();
}
function renderParticipation(schedule = view()) {
  const ready = fresh(), connected = !!wallet.address;
  const currentEntry = [arena?.myCurrentEntry,arena?.myNextEntry].find(entry => entry?.roundId === schedule.current?.id);
  const nextEntry = targetEntry(schedule);
  const unavailable = !connected ? 'Connect your wallet to view your entries.' : !ready ? 'Checking your saved entries…' : null;
  stateText('wallet-status', connected ? 'Wallet connected' : 'Wallet not connected');
  stateText('wallet-address', wallet.address || 'Not connected');
  stateText('wallet-network', !connected ? 'Choose a wallet to continue' : wallet.chainId === settings.network.chainId ? 'Robinhood Chain' : 'Switch to Robinhood Chain');
  stateText('my-current-entry', unavailable || (currentEntry ? 'Participating in round #' + currentEntry.roundId : schedule.current ? 'Not registered for round #' + schedule.current.id : 'No trading round has started yet.'));
  stateText('my-next-entry', unavailable || (nextEntry ? 'Registered for round #' + nextEntry.roundId : schedule.next ? 'Not registered for round #' + schedule.next.id : 'The first round has not opened.'));
  stateText('my-participation', unavailable || (currentEntry ? 'You are participating in round #' + currentEntry.roundId + (nextEntry ? ' and registered for round #' + nextEntry.roundId + '.' : '.') : nextEntry ? 'Your entry for round #' + nextEntry.roundId + ' is saved.' : 'No confirmed entry for the current or next round.'));
}
function renderEntry() {
  const schedule = view(), registered = targetEntry(schedule);
  const connect = $('#connect');
  if (connect) {
    connect.textContent = busy === 'resume' ? 'Restoring wallet…' : wallet.address ? short(wallet.address) + ' · Disconnect' : 'Connect wallet ↗';
    connect.disabled = !!busy;
  }
  for (const node of stateNodes('entry-title')) node.innerHTML = registered ? 'You’re on<br>the list.' : wallet.address ? 'Your next<br>round.' : 'Your place is<br>waiting.';
  renderParticipation(schedule);
  const panel = $('#entry-content');
  if (!panel) return;
  panel.replaceChildren();
  if (!wallet.address) {
    panel.append(text('p', !arena ? 'Connect your wallet to check access and entry status.' : settings.tokenAddress ? 'Connect your wallet, check your 10M $ARENA balance and register during the entry period.' : 'Connect your wallet to get ready. The official $ARENA token has not been activated yet.'));
    panel.append(button('Connect wallet ↗', openWallets));
  } else {
    panel.append(text('p', 'Connected: ' + short(wallet.address), 'wallet-address'));
    const currentEntry = [arena?.myCurrentEntry,arena?.myNextEntry].find(entry => entry?.roundId === schedule.current?.id);
    if (currentEntry) panel.append(text('p', 'Participating in round #' + currentEntry.roundId + '. Trading results are pending.', 'return'));
    if (wallet.chainId !== settings.network.chainId) {
      panel.append(text('p', 'Your wallet is on a different network. ARENA uses Robinhood Chain.', 'outside'));
      panel.append(button(busy === 'network' ? 'Check your wallet…' : 'Switch to Robinhood Chain', switchNetwork));
    } else {
      panel.append(text('p', 'Robinhood Chain connected', 'return'));
      if (!settings.tokenAddress || settings.decimals === null) {
        panel.append(text('p', '$ARENA token details are coming soon. The main timer and registration start after the official contract is activated.'));
      } else {
        const token = text('a', 'View $ARENA contract ↗', 'token-link');
        token.href = settings.network.blockExplorerUrls[0] + '/address/' + settings.tokenAddress;
        token.target = '_blank'; token.rel = 'noopener noreferrer';
        panel.append(token);
        if (registered) {
          panel.append(text('p', '✓ Registered for round #' + registered.roundId, 'return'));
          panel.append(text('p', 'Starts ' + when(schedule.next.start) + '. Your entry is saved.'));
        } else {
          if (snapshot) {
            panel.append(text('p', snapshot.eligible ? '✓ Balance requirement met' : 'Insufficient $ARENA balance', snapshot.eligible ? 'return' : 'outside'));
            panel.append(text('p', 'Your balance: ' + formatTokens(snapshot.balance, settings.decimals) + ' $ARENA'));
            if (!snapshot.eligible) panel.append(text('p', 'Missing: ' + formatTokens(snapshot.missing, settings.decimals) + ' $ARENA'));
          } else {
            panel.append(text('p', 'Required: 10,000,000 $ARENA. Checking your balance and registering are separate actions.'));
          }
          panel.append(button(busy === 'balance' ? 'Checking balance…' : snapshot ? 'Refresh balance' : 'Check balance', checkBalance));
          const isOpen = fresh() && schedule.registration?.open;
          const join = button(busy === 'join' ? 'Confirming registration…' : isOpen ? 'Join round #' + schedule.next.id + ' ↗' : 'Registration not open', joinRound);
          join.disabled = !!busy || !isOpen || !snapshot?.eligible;
          join.classList.add('registration-locked');
          panel.append(join);
          if (isOpen && snapshot?.eligible) panel.append(text('p', 'Sign a message for this round. The server rechecks your token balance before confirming entry.', 'muted'));
        }
      }
    }
  }
  if (!fresh()) {
    panel.append(text('p', syncError || 'Connecting to the arena…', 'muted'));
    if (syncError) panel.append(button('Retry arena connection', refreshArena, 'outline'));
  }
  if (message) {
    const error = text('p', message, 'outside'); error.setAttribute('role','alert'); panel.append(error);
  }
}
function renderWallets() {
  const list = $('#wallet-list');
  if (!list) return;
  list.replaceChildren();
  if (!discovery.items.length) {
    list.append(text('p','No browser wallet detected. Open this site in a browser with an EVM wallet extension, or use your wallet’s built-in browser.'));
    list.append(button('Look for wallets again ↻', () => discovery.request(), 'outline'));
  } else for (const item of discovery.items) list.append(button(busy === 'connect' ? 'Check your wallet…' : item.name, () => connect(item.provider), 'outline wallet-option'));
}
function rememberProvider(provider) {
  const item = discovery.items.find(item => item.provider === provider);
  providerPreference = item?.rdns ? 'rdns:' + item.rdns : provider === window.ethereum ? 'injected' : null;
  try {
    if (providerPreference) localStorage.setItem(providerPreferenceKey, providerPreference);
    else localStorage.removeItem(providerPreferenceKey);
  } catch { /* Provider selection is a convenience, never an authorization. */ }
}
function forgetProvider() {
  providerPreference = null;
  resumeFinished = true;
  try { localStorage.removeItem(providerPreferenceKey); } catch { /* Storage is optional. */ }
}
async function tryResume() {
  if (!providerPreference || resumeFinished || busy || wallet.address) return;
  const matches = discovery.items.filter(item => providerPreference === 'injected'
    ? item.provider === window.ethereum : item.rdns && providerPreference === 'rdns:' + item.rdns);
  // Do not guess between providers advertising the same identity.
  if (matches.length !== 1) return;
  resumeFinished = true;
  busy = 'resume'; renderEntry(); renderWallets();
  try {
    if (!await wallet.resume(matches[0].provider)) forgetProvider();
  } catch { /* A locked/unavailable wallet stays disconnected until the user connects. */ }
  finally { busy = ''; await refreshArena(); renderEntry(); renderWallets(); }
}
function openWallets() {
  if (busy) return;
  stateText('wallet-error', '');
  $('#wallet-dialog')?.showModal(); discovery.request();
}
async function connect(provider) {
  if (busy) return;
  resumeFinished = true;
  busy = 'connect'; stateText('wallet-error', ''); renderWallets(); renderEntry();
  try {
    await wallet.connect(provider); rememberProvider(provider); $('#wallet-dialog')?.close(); await refreshArena(); toast('Wallet connected.');
  } catch (error) { stateText('wallet-error', walletError(error)); }
  finally { busy = ''; renderWallets(); renderEntry(); }
}
async function switchNetwork() {
  if (busy) return;
  busy = 'network'; message = ''; renderEntry();
  try { await wallet.switchNetwork(settings.network); }
  catch (error) { message = walletError(error); }
  finally { busy = ''; renderEntry(); }
}
async function checkBalance() {
  if (busy) return;
  busy = 'balance'; snapshot = null; message = ''; renderEntry();
  try { snapshot = await wallet.checkBalance(settings); }
  catch (error) { message = walletError(error); }
  finally { busy = ''; renderEntry(); }
}
async function joinRound() {
  if (busy || !fresh() || !snapshot?.eligible || !view().registration?.open) return;
  busy = 'join'; message = ''; renderEntry();
  const address = wallet.address, roundId = view().next.id;
  try {
    const challenge = await api('entry/challenge', {address,roundId});
    const signature = await wallet.signEntry(challenge, {...settings,targetRoundId:roundId}, location.origin);
    const receipt = await api('entry/register', {nonce:challenge.nonce,signature});
    if (address === wallet.address) toast('Registered for round #' + receipt.roundId + '. Your entry is saved.');
  } catch (error) { message = walletError(error); }
  finally { busy = ''; await refreshArena(); renderEntry(); }
}
const faq = {
  'When does the first round start?': 'Activating the official $ARENA token starts the main arena timer at 30:00 and opens registration. At zero, registration closes and the same timer switches to the first 24-hour trading round.',
  'When can I join?': 'The first registration period lasts 30 minutes after token activation. For subsequent rounds, registration opens in the final hour of the current round. Check your 10M $ARENA balance, then register separately.',
  'Can I join a round after it starts?': 'No. Everyone starts together. The server rejects entries once the round starts.',
  'Does refreshing the page reset the timer?': 'No. Everyone shares one server schedule. Refreshing a page or restarting the site does not restart registration.',
  'Does +50% qualify?': 'No. Trading return measured in ETH must be strictly above +50%. Exactly +50% does not qualify.',
  'How are winners ranked?': 'By verified trading return in ETH, highest first. At most ten participants above +50% qualify. Tie-breaking rules will be confirmed before launch.',
  'Do higher places earn a bigger share?': 'No. Winners split the allocated round pool equally. With ten winners, each receives 10%. Rules for fewer than ten qualifiers are pending confirmation.',
  'Can I enter the next round while the current one is live?': 'Yes, in its final hour. Current trading continues. Registration does not automatically carry over.',
  'How will trading return be measured?': 'The eligible portfolio, including open positions, must be valued in ETH, excluding external deposits and withdrawals. Portfolio ingestion, detailed valuation rules and payouts are still being prepared.',
};
const faqList = $('#faq');
if (faqList && ![...faqList.children].some(node => node.tagName.toLowerCase() === 'details')) {
  faqList.replaceChildren();
  for (const [question,answer] of Object.entries(faq)) {
    const item = document.createElement('details'); item.append(text('summary',question),text('p',answer)); faqList.append(item);
  }
}
stateText('pending-rules', pending.join(' · ') + '. These terms still require confirmation.');
$('#search')?.addEventListener('input', renderArena);
$('#connect')?.addEventListener('click', () => {
  if (busy) return;
  if (wallet.address) { forgetProvider(); wallet.disconnect(); toast('Wallet disconnected.'); }
  else openWallets();
});
for (const node of document.querySelectorAll('[data-connect-wallet]')) node.addEventListener('click', event => { event.preventDefault(); openWallets(); });
$('#close-dialog')?.addEventListener('click', () => $('#wallet-dialog')?.close());
window.addEventListener('arena:state-request', publishState);
window.addEventListener('focus', () => {
  if (wallet.provider && !busy) wallet.refresh().catch(() => wallet.disconnect());
  refreshArena();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) snapshot = null;
  else { refreshArena(); renderEntry(); }
});
window.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  snapshot = null;
  if (wallet.provider && !busy) wallet.refresh().catch(() => wallet.disconnect());
  refreshArena();
});
setInterval(() => {
  if (snapshot && Date.now() - snapshot.checkedAt > 60000) { snapshot = null; renderEntry(); }
  renderArena();
},1000);
setInterval(() => { if (!document.hidden) refreshArena(); },15000);
renderEntry(); renderArena(); refreshArena(); discovery.request();
