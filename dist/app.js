import { config, pending } from './lib/config.js';
import { BrowserWallet, WalletDiscovery, walletError, formatTokens } from './lib/wallet.js';
import { scheduleAt, countdown } from './lib/schedule.js';

const $ = selector => document.querySelector(selector);
const short = address => address.slice(0, 6) + '…' + address.slice(-4);
const when = time => new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(time) + ' / ' + new Date(time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) + ' local';
let busy = '', message = '', snapshot = null, toastTimer;
let arena = null, settings = {...config,tokenAddress:null,decimals:null}, syncedAt = 0, serverBase = 0, syncError = '', requestId = 0, entryKey = '';
const wallet = new BrowserWallet(() => {
  snapshot = null;
  message = '';
  if (arena) arena = {...arena,myCurrentEntry:null,myNextEntry:null};
  renderEntry();
  refreshArena();
});
const discovery = new WalletDiscovery(window, () => renderWallets());

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
  $('#toast').textContent = content;
  $('#toast').style.display = 'block';
  toastTimer = setTimeout(() => { $('#toast').style.display = 'none'; }, 5000);
}
function fresh() { return !!arena && !syncError && performance.now() - syncedAt < 45000; }
function serverNow() { return Math.floor(serverBase + performance.now() - syncedAt); }
function view() { return scheduleAt(arena?.activatedAt ?? null, arena ? serverNow() : 0); }
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
    if (!Number.isSafeInteger(data.serverNow) || !(data.activatedAt === null || Number.isSafeInteger(data.activatedAt))) throw Error('Invalid arena timing. Please refresh.');
    if (data.token && (!/^0x[0-9a-f]{40}$/i.test(data.token.address) || data.token.chainId !== 4663 || !Number.isInteger(data.token.decimals) || data.token.decimals < 0 || data.token.decimals > 255)) throw Error('Token configuration is unavailable.');
    if (!!data.token !== (data.activatedAt !== null)) throw Error('Arena configuration is unavailable.');
    const previousToken = settings.tokenAddress;
    arena = data;
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
  $('#round-status').textContent = !ready ? (syncError ? '◇ UPDATES UNAVAILABLE' : '◇ CONNECTING') : first ? '● REGISTRATION OPEN' : schedule.current ? '● LIVE ROUND' : '◇ AWAITING LAUNCH';
  $('#round-status').classList.toggle('awaiting', !ready || schedule.phase === 'prelaunch');
  $('#launch-badge').textContent = first ? 'Registration open' : schedule.current ? 'Daily rounds' : 'Coming soon';
  $('#round-label').textContent = first ? 'UPCOMING ROUND' : 'CURRENT ROUND';
  $('#round-number').textContent = first ? '#001' : schedule.current ? '#' + String(schedule.current.id).padStart(3,'0') : 'Not started';
  $('#round-dates').textContent = schedule.current ? when(schedule.current.start) : first ? when(schedule.next.start) : 'First round to be announced';
  $('#timer-label').textContent = first ? 'REGISTRATION CLOSES IN' : schedule.current ? 'ROUND ENDS IN' : 'FIRST ROUND STARTS';
  const end = first ? schedule.next.start : schedule.current?.end;
  // The same main timer counts 30 minutes before round 1 and 24 hours during trading.
  const remaining = ready && end ? countdown(end - serverNow()) : '—';
  $('#timer').textContent = first && remaining !== '—' ? remaining.slice(3) : remaining;
  $('#timer-note').textContent = !ready && arena ? 'Synchronizing with the arena' : first ? 'Round #1 starts when this reaches zero' : schedule.current ? '24-hour trading round' : '30-minute first entry window';
  $('#launch-label').textContent = first ? 'REGISTRATION IS OPEN' : schedule.current ? 'THE ROUND IS LIVE' : 'THE FIRST SUMMIT';
  $('#launch-note').textContent = syncError || (first ? 'Hold 10M $APEX, check your balance and register before the main timer reaches zero. Everyone starts together.' : schedule.current ? 'Registration for this round is closed. The next round opens for entries in the final hour. Portfolio results are not connected yet.' : 'When the official $APEX token is activated, the main timer starts at 30:00 and registration opens. At zero, the first 24-hour round begins.');
  $('#traders-label').textContent = first ? 'REGISTERED FOR ROUND #1' : 'TRADERS IN THE ARENA';
  const count = first ? arena?.nextParticipants : arena?.current?.id === schedule.current?.id ? arena?.participants : arena?.next?.id === schedule.current?.id ? arena?.nextParticipants : 0;
  $('#traders').textContent = ready ? String(count ?? 0) : '—';
  $('#traders-note').textContent = first ? 'Confirmed registrations' : schedule.current ? 'Return data pending' : 'Registration has not opened';
  $('#board-status').textContent = schedule.current ? 'Awaiting portfolio data' : first ? 'Registration in progress' : 'Awaiting first round';
  $('#board-message').textContent = $('#search').value.trim() ? 'No verified results to search yet.' : schedule.current ? 'Trading results are not available yet.' : 'Verified results will appear after trading begins.';
  $('#next-label').textContent = schedule.next ? (first ? 'FIRST ROUND #1' : 'NEXT ROUND #' + schedule.next.id) : 'FIRST ROUND';
  $('#next-status').textContent = !ready ? 'Checking registration status' : registration?.open ? 'Registration open' : 'Registration not open';
  $('#next-start').textContent = schedule.next ? (registration.open ? 'Starts ' : 'Entry opens ' + when(registration.opensAt) + '. Starts ') + when(schedule.next.start) + '.' : 'Starts 30 minutes after the official token is activated.';
  const key = [schedule.phase,schedule.current?.id,schedule.next?.id,registration?.open,ready].join(':');
  if (key !== entryKey) { entryKey = key; renderEntry(); }
}
function renderEntry() {
  const schedule = view(), registered = targetEntry(schedule);
  $('#connect').textContent = wallet.address ? short(wallet.address) + ' · Disconnect' : 'Connect wallet ↗';
  $('#connect').disabled = !!busy;
  $('#entry-title').innerHTML = registered ? 'You’re on<br>the list.' : wallet.address ? 'Your next<br>summit.' : 'Your place is<br>waiting.';
  const panel = $('#entry-content');
  panel.replaceChildren();
  if (!wallet.address) {
    panel.append(text('p', settings.tokenAddress ? 'Connect your wallet, check your 10M $APEX balance and register during the entry period.' : 'Connect your wallet to get ready. The official $APEX token has not been activated yet.'));
    panel.append(button('Connect wallet ↗', openWallets));
  } else {
    panel.append(text('p', 'Connected: ' + short(wallet.address), 'wallet-address'));
    const currentEntry = [arena?.myCurrentEntry,arena?.myNextEntry].find(entry => entry?.roundId === schedule.current?.id);
    if (currentEntry) panel.append(text('p', 'Participating in round #' + currentEntry.roundId + '. Trading results are pending.', 'return'));
    if (wallet.chainId !== settings.network.chainId) {
      panel.append(text('p', 'Your wallet is on a different network. APEX uses Robinhood Chain.', 'outside'));
      panel.append(button(busy === 'network' ? 'Check your wallet…' : 'Switch to Robinhood Chain ↗', switchNetwork));
    } else {
      panel.append(text('p', 'Robinhood Chain connected', 'return'));
      if (!settings.tokenAddress || settings.decimals === null) {
        panel.append(text('p', '$APEX token details are coming soon. The main timer and registration start after the official contract is activated.'));
      } else {
        const token = text('a', 'View $APEX contract ↗', 'token-link');
        token.href = settings.network.blockExplorerUrls[0] + '/address/' + settings.tokenAddress;
        token.target = '_blank'; token.rel = 'noopener noreferrer';
        panel.append(token);
        if (registered) {
          panel.append(text('p', '✓ Registered for round #' + registered.roundId, 'return'));
          panel.append(text('p', 'Starts ' + when(schedule.next.start) + '. Your entry is saved.'));
        } else {
          if (snapshot) {
            panel.append(text('p', snapshot.eligible ? '✓ Balance requirement met' : 'Insufficient $APEX balance', snapshot.eligible ? 'return' : 'outside'));
            panel.append(text('p', 'Your balance: ' + formatTokens(snapshot.balance, settings.decimals) + ' $APEX'));
            if (!snapshot.eligible) panel.append(text('p', 'Missing: ' + formatTokens(snapshot.missing, settings.decimals) + ' $APEX'));
          } else {
            panel.append(text('p', 'Required: 10,000,000 $APEX. Checking your balance and registering are separate actions.'));
          }
          panel.append(button(busy === 'balance' ? 'Checking balance…' : snapshot ? 'Refresh balance ↗' : 'Check balance ↗', checkBalance));
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
  const list = $('#wallet-list'); list.replaceChildren();
  if (!discovery.items.length) {
    list.append(text('p','No browser wallet detected. Open this site in a browser with an EVM wallet extension, or use your wallet’s built-in browser.'));
    list.append(button('Look for wallets again ↻', () => discovery.request(), 'outline'));
  } else for (const item of discovery.items) list.append(button(busy === 'connect' ? 'Check your wallet…' : item.name + ' ↗', () => connect(item.provider), 'outline wallet-option'));
}
function openWallets() {
  if (busy) return;
  $('#wallet-error').textContent = '';
  $('#wallet-dialog').showModal(); discovery.request();
}
async function connect(provider) {
  if (busy) return;
  busy = 'connect'; $('#wallet-error').textContent = ''; renderWallets(); renderEntry();
  try {
    await wallet.connect(provider); $('#wallet-dialog').close(); await refreshArena(); toast('Wallet connected.');
  } catch (error) { $('#wallet-error').textContent = walletError(error); }
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
  'When does the first round start?': 'Activating the official $APEX token starts the main arena timer at 30:00 and opens registration. At zero, registration closes and the same timer switches to the first 24-hour trading round.',
  'When can I join?': 'The first registration period lasts 30 minutes after token activation. For subsequent rounds, registration opens in the final hour of the current round. Check your 10M $APEX balance, then register separately.',
  'Can I join a round after it starts?': 'No. Everyone starts together. The server rejects entries once the round starts.',
  'Does refreshing the page reset the timer?': 'No. Everyone shares one server schedule. Refreshing a page or restarting the site does not restart registration.',
  'Does +50% qualify?': 'No. Trading return measured in ETH must be strictly above +50%. Exactly +50% does not qualify.',
  'How are winners ranked?': 'By verified trading return in ETH, highest first. At most ten participants above +50% qualify. Tie-breaking rules will be confirmed before launch.',
  'Do higher places earn a bigger share?': 'No. Winners split the allocated round pool equally. With ten winners, each receives 10%. Rules for fewer than ten qualifiers are pending confirmation.',
  'Can I enter the next round while the current one is live?': 'Yes, in its final hour. Current trading continues. Registration does not automatically carry over.',
  'How will trading return be measured?': 'The eligible portfolio, including open positions, must be valued in ETH, excluding external deposits and withdrawals. Portfolio ingestion, detailed valuation rules and payouts are still being prepared.',
};
for (const [question,answer] of Object.entries(faq)) {
  const item = document.createElement('details'); item.append(text('summary',question),text('p',answer)); $('#faq').append(item);
}
$('#pending-rules').textContent = pending.join(' · ') + '. These terms still require confirmation.';
$('#search').addEventListener('input', renderArena);
$('#connect').addEventListener('click', () => { if (wallet.address) { wallet.disconnect(); toast('Disconnected from this page.'); } else openWallets(); });
$('#close-dialog').addEventListener('click', () => $('#wallet-dialog').close());
window.addEventListener('focus', () => {
  if (wallet.provider && !busy) wallet.refresh().catch(() => wallet.disconnect());
  refreshArena();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) snapshot = null;
  else { refreshArena(); renderEntry(); }
});
setInterval(() => {
  if (snapshot && Date.now() - snapshot.checkedAt > 60000) { snapshot = null; renderEntry(); }
  renderArena();
},1000);
setInterval(() => { if (!document.hidden) refreshArena(); },15000);
renderEntry(); refreshArena();
