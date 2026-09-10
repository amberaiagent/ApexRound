import { config, pending } from './lib/config.js';
import { BrowserWallet, WalletDiscovery, walletError, formatTokens } from './lib/wallet.js';

const $ = selector => document.querySelector(selector);
const short = address => address.slice(0, 6) + '…' + address.slice(-4);
let busy = '', message = '', snapshot = null, toastTimer;
const wallet = new BrowserWallet(() => {
  snapshot = null;
  message = '';
  renderEntry();
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

function renderEntry() {
  $('#connect').textContent = wallet.address ? short(wallet.address) + ' · Disconnect' : 'Connect wallet ↗';
  $('#connect').disabled = !!busy;
  $('#entry-title').innerHTML = wallet.address ? 'You’re early.<br>Stay ready.' : 'Your place is<br>waiting.';
  const panel = $('#entry-content');
  panel.replaceChildren();
  if (!wallet.address) {
    panel.append(text('p', 'Connect your wallet to get ready. The first round and $APEX token details will be announced here.'));
    panel.append(button('Connect wallet ↗', openWallets));
  } else {
    panel.append(text('p', 'Connected: ' + short(wallet.address), 'wallet-address'));
    if (wallet.chainId !== config.network.chainId) {
      panel.append(text('p', 'Your wallet is on a different network. APEX uses Robinhood Chain.', 'outside'));
      panel.append(button(busy === 'network' ? 'Check your wallet…' : 'Switch to Robinhood Chain ↗', switchNetwork));
    } else {
      panel.append(text('p', 'Robinhood Chain connected', 'return'));
      if (!config.tokenAddress || config.decimals === null) {
        panel.append(text('p', '$APEX token details are coming soon. Balance verification will open once the official contract is published.'));
      } else {
        const token = text('a', 'View $APEX contract ↗', 'token-link');
        token.href = config.network.blockExplorerUrls[0] + '/address/' + config.tokenAddress;
        token.target = '_blank';
        token.rel = 'noopener noreferrer';
        panel.append(token);
        if (snapshot) {
          panel.append(text('p', snapshot.eligible ? '✓ Balance requirement met' : 'Insufficient $APEX balance', snapshot.eligible ? 'return' : 'outside'));
          panel.append(text('p', 'Your balance: ' + formatTokens(snapshot.balance, config.decimals) + ' $APEX'));
          if (!snapshot.eligible) panel.append(text('p', 'Missing: ' + formatTokens(snapshot.missing, config.decimals) + ' $APEX'));
          panel.append(text('p', 'Checked at ' + new Date(snapshot.checkedAt).toLocaleTimeString() + '. Checking your balance does not register you.', 'muted'));
        } else {
          panel.append(text('p', 'Required: 10,000,000 $APEX. Check your current token balance.'));
        }
        panel.append(button(busy === 'balance' ? 'Checking balance…' : snapshot ? 'Refresh balance ↗' : 'Check balance ↗', checkBalance));
      }
    }
    const join = button('Registration not open', () => {});
    join.disabled = true;
    join.classList.add('registration-locked');
    panel.append(join);
  }
  if (message) {
    const error = text('p', message, 'outside');
    error.setAttribute('role', 'alert');
    panel.append(error);
  }
}

function renderWallets() {
  const list = $('#wallet-list');
  list.replaceChildren();
  if (!discovery.items.length) {
    list.append(text('p', 'No browser wallet detected. Open this site in a browser with an EVM wallet extension, or use your wallet’s built-in browser.'));
    list.append(button('Look for wallets again ↻', () => discovery.request(), 'outline'));
  } else {
    for (const item of discovery.items) {
      list.append(button(busy === 'connect' ? 'Check your wallet…' : item.name + ' ↗', () => connect(item.provider), 'outline wallet-option'));
    }
  }
}

function openWallets() {
  if (busy) return;
  $('#wallet-error').textContent = '';
  $('#wallet-dialog').showModal();
  discovery.request();
}

async function connect(provider) {
  if (busy) return;
  busy = 'connect';
  $('#wallet-error').textContent = '';
  renderWallets();
  renderEntry();
  try {
    await wallet.connect(provider);
    $('#wallet-dialog').close();
    toast('Wallet connected. Registration has not opened yet.');
  } catch (error) {
    $('#wallet-error').textContent = walletError(error);
  } finally {
    busy = '';
    renderWallets();
    renderEntry();
  }
}

async function switchNetwork() {
  if (busy) return;
  busy = 'network';
  message = '';
  renderEntry();
  try {
    await wallet.switchNetwork(config.network);
  } catch (error) {
    message = walletError(error);
  } finally {
    busy = '';
    renderEntry();
  }
}

async function checkBalance() {
  if (busy) return;
  busy = 'balance';
  snapshot = null;
  message = '';
  renderEntry();
  try {
    snapshot = await wallet.checkBalance(config);
  } catch (error) {
    message = walletError(error);
  } finally {
    busy = '';
    renderEntry();
  }
}

const faq = {
  'When does the first round start?': 'The launch date has not been announced yet. Registration is closed. The schedule and complete rules will be published before entry opens.',
  'When can I join?': 'After launch, registration opens in the final hour of the current round. Check your 10M $APEX balance, then register separately for the next round. The first entry window will be announced with the launch date.',
  'Can I join a round after it starts?': 'No. Everyone starts together and registration closes at the start.',
  'Does +50% qualify?': 'No. Trading return measured in ETH must be strictly above +50%. Exactly +50% does not qualify.',
  'How are winners ranked?': 'By verified trading return in ETH, highest first. At most ten participants above +50% qualify. Tie-breaking rules will be confirmed before launch.',
  'Do higher places earn a bigger share?': 'No. Winners split the allocated round pool equally. With ten winners, each receives 10%. Rules for fewer than ten qualifiers are pending confirmation.',
  'Can I enter the next round while the current one is live?': 'Yes, in its final hour. Current trading continues. Registration does not automatically carry over.',
  'How will trading return be measured?': 'The eligible portfolio, including open positions, will be valued in ETH. External deposits and withdrawals must be excluded from trading profit. The detailed pricing and valuation rules will be published before competitions begin.',
};
for (const [question, answer] of Object.entries(faq)) {
  const item = document.createElement('details');
  item.append(text('summary', question), text('p', answer));
  $('#faq').append(item);
}
$('#pending-rules').textContent = pending.join(' · ') + '. These terms will be published before registration opens.';
$('#search').addEventListener('input', () => {
  $('#board-message').textContent = $('#search').value.trim() ? 'No participants to search yet.' : 'The leaderboard starts with the first round.';
});
$('#connect').addEventListener('click', () => {
  if (wallet.address) {
    wallet.disconnect();
    toast('Disconnected from this page.');
  } else {
    openWallets();
  }
});
$('#close-dialog').addEventListener('click', () => $('#wallet-dialog').close());
window.addEventListener('focus', () => {
  if (wallet.provider && !busy) wallet.refresh().catch(() => wallet.disconnect());
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) snapshot = null;
  else renderEntry();
});
setInterval(() => {
  if (snapshot && Date.now() - snapshot.checkedAt > 60000) {
    snapshot = null;
    renderEntry();
  }
}, 5000);
renderEntry();
