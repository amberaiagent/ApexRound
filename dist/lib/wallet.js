import { entryMessage } from './entry-message.js';
const isAddress = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value);
const account = accounts => Array.isArray(accounts) && isAddress(accounts[0]) ? accounts[0].toLowerCase() : null;
const chain = value => {
  if (typeof value !== 'string' || !/^0x[0-9a-f]+$/i.test(value)) throw new Error('The wallet returned an invalid network.');
  return '0x' + BigInt(value).toString(16);
};

function requestWithTimeout(provider, args, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The wallet did not respond. Check it and try again.')), timeout);
    Promise.resolve().then(() => provider.request(args)).then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function walletError(error) {
  const code = Number(error?.code);
  if (code === 4001) return 'Request cancelled in your wallet. You can try again.';
  if (code === -32002) return 'A request is already open. Check your wallet extension.';
  if (code === 4100) return 'Allow this site to access your wallet, then try again.';
  if (code === 4200 || code === -32601) return 'Your wallet does not support this request. Try another browser wallet.';
  if (code === 4900 || code === 4901) return 'Your wallet is offline. Reconnect it and try again.';
  return typeof error?.message === 'string' ? error.message.slice(0, 240) : 'Wallet request failed. Please try again.';
}

// EIP-6963 discovery persists for the page lifetime, including late announcements.
// Provider labels are untrusted. Do not render provider-supplied HTML or icons.
export class WalletDiscovery {
  constructor(target, onChange = () => {}) {
    this.target = target;
    this.onChange = onChange;
    this.items = [];
    target.addEventListener('eip6963:announceProvider', event => {
      const { info, provider } = event.detail ?? {};
      if (provider && typeof provider.request === 'function' && typeof info?.name === 'string') {
        this.add(provider, info.name.slice(0, 64));
      }
    });
  }

  add(provider, name) {
    const existing = this.items.find(item => item.provider === provider);
    if (existing) {
      if (existing.name === 'Browser wallet') existing.name = name;
    } else {
      this.items.push({ provider, name });
    }
    this.onChange(this.items);
  }

  request() {
    this.target.dispatchEvent(new Event('eip6963:requestProvider'));
    const injected = this.target.ethereum;
    if (typeof injected?.request === 'function' && !this.items.some(item => item.provider === injected)) {
      this.add(injected, 'Browser wallet');
    }
    this.onChange(this.items);
  }
}

export class BrowserWallet {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.provider = null;
    this.address = null;
    this.chainId = null;
    this.version = 0;
    this.connection = 0;
    this.listeners = [];
  }

  changed() {
    this.version++;
    this.onChange();
  }

  disconnect() {
    for (const [event, handler] of this.listeners) this.provider?.removeListener?.(event, handler);
    this.listeners = [];
    this.provider = null;
    this.address = null;
    this.chainId = null;
    this.connection++;
    this.changed();
  }

  async connect(provider) {
    this.disconnect();
    const connection = this.connection;
    this.provider = provider;
    const handlers = {
      accountsChanged: accounts => { this.address = account(accounts); this.changed(); },
      chainChanged: value => {
        try { this.chainId = chain(value); } catch { this.chainId = null; }
        this.changed();
      },
      disconnect: () => this.disconnect(),
    };
    for (const [event, handler] of Object.entries(handlers)) {
      if (typeof provider.on === 'function') {
        const guarded = value => {
          if (this.provider === provider && this.connection === connection) handler(value);
        };
        provider.on(event, guarded);
        this.listeners.push([event, guarded]);
      }
    }
    try {
      await requestWithTimeout(provider, { method: 'eth_requestAccounts' }, 90000);
      if (this.connection !== connection) throw new Error('Wallet connection changed. Try again.');
      await this.refresh(connection);
      if (!this.address) throw new Error('No account selected. Unlock your wallet and try again.');
      return this.address;
    } catch (error) {
      if (this.connection === connection) this.disconnect();
      throw error;
    }
  }

  async refresh(connection = this.connection) {
    const provider = this.provider;
    if (!provider) throw new Error('Connect your wallet first.');
    // Discard snapshots if a wallet event arrived while the RPC calls were running.
    for (let attempt = 0; attempt < 3; attempt++) {
      const version = this.version;
      const [accounts, chainId] = await Promise.all([
        requestWithTimeout(provider, { method: 'eth_accounts' }),
        requestWithTimeout(provider, { method: 'eth_chainId' }),
      ]);
      if (connection !== this.connection) throw new Error('Wallet connection changed. Try again.');
      if (version !== this.version) continue;
      const nextAddress = account(accounts), nextChain = chain(chainId);
      if (this.address !== nextAddress || this.chainId !== nextChain) {
        this.address = nextAddress;
        this.chainId = nextChain;
        this.changed();
      }
      return;
    }
    throw new Error('Your wallet changed during the request. Please try again.');
  }

  async switchNetwork(network) {
    const provider = this.provider, connection = this.connection;
    if (!provider) throw new Error('Connect your wallet first.');
    try {
      await requestWithTimeout(provider, { method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] }, 90000);
    } catch (error) {
      if (Number(error?.code) !== 4902) throw error;
      if (connection !== this.connection) throw new Error('Wallet connection changed. Try again.');
      await requestWithTimeout(provider, { method: 'wallet_addEthereumChain', params: [network] }, 90000);
      if (connection !== this.connection) throw new Error('Wallet connection changed. Try again.');
      await requestWithTimeout(provider, { method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] }, 90000);
    }
    await this.refresh(connection);
    if (this.chainId !== chain(network.chainId)) throw new Error('Select Robinhood Chain in your wallet to continue.');
  }

  async checkBalance(settings) {
    if (!isAddress(settings.tokenAddress) || /^0x0{40}$/i.test(settings.tokenAddress)) {
      throw new Error('The $APEX token contract has not been announced yet.');
    }
    if (!Number.isInteger(settings.decimals) || settings.decimals < 0 || settings.decimals > 255) {
      throw new Error('Token verification is not configured yet.');
    }
    await this.refresh();
    if (!this.address) throw new Error('Connect your wallet first.');
    if (this.chainId !== chain(settings.network.chainId)) throw new Error('Switch to Robinhood Chain first.');
    const provider = this.provider, address = this.address, version = this.version, connection = this.connection;
    const request = (method, params) => requestWithTimeout(provider, { method, params });
    const block = await request('eth_blockNumber', []);
    if (!/^0x[0-9a-f]+$/i.test(block)) throw new Error('Unable to read the current block. Try again.');
    const [code, decimalValue, raw] = await Promise.all([
      request('eth_getCode', [settings.tokenAddress, block]),
      request('eth_call', [{ to: settings.tokenAddress, data: '0x313ce567' }, block]),
      request('eth_call', [{ to: settings.tokenAddress, data: '0x70a08231' + address.slice(2).padStart(64, '0') }, block]),
    ]);
    if (!/^0x[0-9a-f]+$/i.test(code) || /^0x0*$/i.test(code)) throw new Error('The configured token contract is unavailable on this network.');
    if (!/^0x[0-9a-f]{64}$/i.test(decimalValue) || BigInt(decimalValue) !== BigInt(settings.decimals)) {
      throw new Error('Token details could not be verified. Please try again later.');
    }
    if (!/^0x[0-9a-f]{64}$/i.test(raw)) throw new Error('The token returned an invalid balance. Please try again.');
    await this.refresh(connection);
    if (this.version !== version) throw new Error('Your wallet or network changed. Check your balance again.');
    const balance = BigInt(raw), required = settings.required * 10n ** BigInt(settings.decimals);
    return { address, balance, required, eligible: balance >= required, missing: balance < required ? required - balance : 0n, block, checkedAt: Date.now() };
  }

  async signEntry(entry, settings, origin) {
    await this.refresh();
    const validTimes = ['startsAt', 'endsAt', 'issuedAt', 'expiresAt'].every(key => Number.isSafeInteger(entry[key]));
    if (!this.address || this.chainId !== settings.network.chainId || entry.address !== this.address
        || entry.chainId !== Number(BigInt(settings.network.chainId)) || entry.origin !== origin
        || entry.tokenAddress !== settings.tokenAddress || entry.roundId !== settings.targetRoundId
        || !Number.isSafeInteger(entry.roundId) || entry.roundId < 1 || !/^[0-9a-f]{48}$/.test(entry.nonce)
        || !validTimes || entry.endsAt - entry.startsAt !== 86400000 || entry.expiresAt > entry.startsAt
        || entry.expiresAt <= entry.issuedAt || entry.expiresAt - entry.issuedAt > 300000
        || entry.message !== entryMessage(entry)) {
      throw new Error('Registration details changed. Refresh the arena and try again.');
    }
    const provider = this.provider, connection = this.connection, version = this.version;
    const hex = '0x' + Array.from(new TextEncoder().encode(entry.message), byte => byte.toString(16).padStart(2, '0')).join('');
    const signature = await requestWithTimeout(provider, { method: 'personal_sign', params: [hex, this.address] }, 90000);
    await this.refresh(connection);
    if (version !== this.version) throw new Error('Your wallet changed. Request a new registration.');
    return signature;
  }
}

export function formatTokens(value, decimals) {
  const unit = 10n ** BigInt(decimals);
  const whole = (value / unit).toLocaleString('en-US');
  const fraction = (value % unit).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? whole + '.' + fraction : whole;
}
