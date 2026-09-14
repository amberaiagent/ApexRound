import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { BrowserWallet, WalletDiscovery, walletError, formatTokens } from '../dist/lib/wallet.js';
import { config } from '../dist/lib/config.js';
import { entryMessage } from '../dist/lib/entry-message.js';

const address = '0x1234567890123456789012345678901234567890';
const other = '0x2234567890123456789012345678901234567890';
const token = '0x3334567890123456789012345678901234567890';
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
const settings = { ...config, tokenAddress: token, decimals: 18 };

class Provider extends EventEmitter {
  accounts = [address];
  chainId = config.network.chainId;
  balance = config.required * 10n ** 18n;
  calls = [];
  async request(args) {
    this.calls.push(args);
    switch (args.method) {
      case 'eth_requestAccounts':
      case 'eth_accounts': return this.accounts;
      case 'eth_chainId': return this.chainId;
      case 'eth_blockNumber': return '0x123';
      case 'eth_getCode': return '0x6080';
      case 'eth_call': return args.params[0].data === '0x313ce567' ? word(18) : word(this.balance);
      case 'wallet_switchEthereumChain':
        this.chainId = args.params[0].chainId;
        this.emit('chainChanged', this.chainId);
        return null;
      case 'wallet_addEthereumChain': return null;
      default: throw Error('Unexpected request: ' + args.method);
    }
  }
}

test('Wallet permission request connects the returned account without signing or transactions', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  assert.equal(await wallet.connect(provider), address);
  assert.equal(wallet.chainId, config.network.chainId);
  assert.deepEqual(provider.calls.map(c => c.method), ['eth_requestAccounts', 'eth_accounts', 'eth_chainId']);
  provider.emit('accountsChanged', [other]);
  assert.equal(wallet.address, other);
  provider.emit('accountsChanged', []);
  assert.equal(wallet.address, null);
  wallet.disconnect();
  assert.equal(provider.listenerCount('chainChanged'), 0);
});

test('Rejected connection does not install a simulated account', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  provider.request = async () => { throw Object.assign(Error('Rejected'), { code: 4001 }); };
  await assert.rejects(wallet.connect(provider), /Rejected/);
  assert.equal(wallet.address, null);
  assert.equal(wallet.provider, null);
  assert.match(walletError({ code: 4001 }), /cancelled/);
});

test('Silent page navigation resumes only previously authorized accounts without permission requests', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  assert.equal(await wallet.resume(provider), address);
  assert.deepEqual(provider.calls.map(call => call.method), ['eth_accounts', 'eth_chainId']);
  provider.emit('accountsChanged', [other]);
  assert.equal(wallet.address, other);
  wallet.disconnect();
  assert.equal(provider.listenerCount('accountsChanged'), 0);
});

test('Silent resume of a locked or revoked wallet cannot request permissions or retain a connection', async () => {
  for (const revoked of [false, true]) {
    const provider = new Provider(), wallet = new BrowserWallet();
    provider.accounts = [];
    const original = provider.request.bind(provider);
    provider.request = args => {
      if (revoked && args.method === 'eth_accounts') {
        provider.calls.push(args);
        throw Object.assign(Error('Authorization revoked'), { code: 4100 });
      }
      return original(args);
    };
    if (revoked) await assert.rejects(wallet.resume(provider), /revoked/);
    else assert.equal(await wallet.resume(provider), null);
    assert.equal(wallet.address, null);
    assert.equal(wallet.provider, null);
    assert.equal(wallet.chainId, null);
    assert.equal(provider.listenerCount('accountsChanged'), 0);
    assert.ok(provider.calls.every(call => ['eth_accounts', 'eth_chainId'].includes(call.method)));
  }
});

test('Disconnect invalidates a late silent-resume response', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  const original = provider.request.bind(provider);
  let release;
  provider.request = args => args.method === 'eth_accounts' ? new Promise(resolve => { release = resolve; }) : original(args);
  const pending = wallet.resume(provider);
  await new Promise(resolve => setImmediate(resolve));
  wallet.disconnect();
  release([address]);
  await assert.rejects(pending, /connection changed/);
  assert.equal(wallet.address, null);
  assert.equal(wallet.provider, null);
});

test('Missing token configuration cannot grant eligibility or issue token RPC reads', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  await wallet.connect(provider);
  await assert.rejects(wallet.checkBalance({ ...config, tokenAddress: null, decimals: null }), /not been announced/);
  assert.ok(provider.calls.every(c => c.method !== 'eth_call'));
});

test('Balance uses one block, exact token decimals and integer threshold including one wei short', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  assert.equal(config.required, 5000000n);
  provider.balance = 5000000n * 10n ** 18n;
  await wallet.connect(provider);
  let result = await wallet.checkBalance(settings);
  assert.equal(result.eligible, true);
  assert.equal(result.required, 5000000n * 10n ** 18n);
  assert.equal(result.missing, 0n);
  provider.balance--;
  result = await wallet.checkBalance(settings);
  assert.equal(result.eligible, false);
  assert.equal(result.missing, 1n);
  assert.equal(formatTokens(result.missing, 18), '0.000000000000000001');
  const reads = provider.calls.filter(c => ['eth_getCode', 'eth_call'].includes(c.method));
  assert.ok(reads.every(c => c.params[1] === '0x123'));
  assert.equal(reads[2].params[0].data, '0x70a08231' + address.slice(2).padStart(64, '0'));
  assert.ok(provider.calls.every(c => !/sign|sendTransaction|approve/i.test(c.method)));
});

test('Wrong network, mismatched decimals, absent contract and malformed balance all fail closed', async () => {
  for (const fault of ['network', 'decimals', 'code', 'balance']) {
    const provider = new Provider(), wallet = new BrowserWallet();
    const original = provider.request.bind(provider);
    provider.request = async args => {
      if (fault === 'code' && args.method === 'eth_getCode') return '0x';
      if (fault === 'decimals' && args.method === 'eth_call' && args.params[0].data === '0x313ce567') return word(6);
      if (fault === 'balance' && args.method === 'eth_call' && args.params[0].data !== '0x313ce567') return '0x1';
      return original(args);
    };
    if (fault === 'network') provider.chainId = '0x1';
    await wallet.connect(provider);
    await assert.rejects(wallet.checkBalance(settings));
  }
});

test('Changing account or network mid-read invalidates the entire balance snapshot', async () => {
  for (const event of ['accountsChanged', 'chainChanged']) {
    const provider = new Provider(), wallet = new BrowserWallet();
    await wallet.connect(provider);
    const original = provider.request.bind(provider);
    provider.request = async args => {
      if (args.method === 'eth_call' && args.params[0].data !== '0x313ce567') {
        if (event === 'accountsChanged') provider.accounts = [other];
        else provider.chainId = '0x1';
        provider.emit(event, event === 'accountsChanged' ? provider.accounts : provider.chainId);
      }
      return original(args);
    };
    await assert.rejects(wallet.checkBalance(settings), /changed/);
  }
});

test('Switching handles an unknown chain and explicitly selects it after adding', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  provider.chainId = '0x1';
  const original = provider.request.bind(provider);
  let first = true;
  provider.request = async args => {
    if (args.method === 'wallet_switchEthereumChain' && first) {
      first = false;
      provider.calls.push(args);
      throw Object.assign(Error('Unknown chain'), { code: 4902 });
    }
    return original(args);
  };
  await wallet.connect(provider);
  await wallet.switchNetwork(config.network);
  assert.equal(wallet.chainId, config.network.chainId);
  assert.deepEqual(provider.calls.filter(c => c.method.startsWith('wallet_')).map(c => c.method), [
    'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_switchEthereumChain',
  ]);
});

test('Late events and late permission responses cannot reconnect a disconnected page', async () => {
  const provider = new Provider(), wallet = new BrowserWallet();
  let release;
  provider.removeListener = undefined;
  const original = provider.request.bind(provider);
  provider.request = args => args.method === 'eth_requestAccounts' ? new Promise(resolve => { release = resolve; }) : original(args);
  const pending = wallet.connect(provider);
  await new Promise(resolve => setImmediate(resolve));
  wallet.disconnect();
  provider.emit('accountsChanged', [other]);
  release([address]);
  await assert.rejects(pending, /changed/);
  assert.equal(wallet.address, null);
  assert.equal(wallet.provider, null);
});

test('Wallet discovery handles late announcements and deduplicates injected providers', () => {
  const target = new EventTarget(), provider = new Provider();
  target.ethereum = provider;
  const discovery = new WalletDiscovery(target);
  discovery.request();
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider, info: { name: 'Example wallet' } } }));
  discovery.request();
  assert.equal(discovery.items.length, 1);
  assert.equal(discovery.items[0].name, 'Example wallet');
});

test('Discovery stores a bounded provider identity without storing wallet accounts', () => {
  const target = new EventTarget(), provider = new Provider();
  target.ethereum = provider;
  const discovery = new WalletDiscovery(target);
  discovery.request();
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    provider, info: { name: 'Example wallet', rdns: 'Com.Example.Wallet' },
  } }));
  assert.equal(discovery.items.length, 1);
  assert.equal(discovery.items[0].rdns, 'com.example.wallet');
  assert.equal(Object.hasOwn(discovery.items[0], 'address'), false);
  target.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    provider: new Provider(), info: { name: 'Other wallet', rdns: '<script>invalid</script>' },
  } }));
  assert.equal(discovery.items[1].rdns, null);
});

test('Public release has no simulation or fabricated round, pool, or registration', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.equal(config.demo, false);
  assert.doesNotMatch(html + app, /DemoWallet|demo-connect|setScenario|set_demo_scenario|#042|12\.80|Demo data|Demo results/);
  assert.match(app, /Registration not open/);
  assert.match(app, /AWAITING LAUNCH/);
  assert.doesNotMatch(app, /\.register\(|personal_sign|eth_sendTransaction/);
});

test('Registration signs only the displayed, domain/token/round-bound message; altered requests never reach the wallet', async () => {
  const base = {
    address, origin: 'https://apex-round.com', chainId: 4663, tokenAddress: token,
    roundId: 1, nonce: 'a'.repeat(48), issuedAt: 1800000000000,
    expiresAt: 1800000300000, startsAt: 1800001800000, endsAt: 1800088200000,
  };
  base.message = entryMessage(base);
  const provider = new Provider(), wallet = new BrowserWallet();
  const original = provider.request.bind(provider);
  provider.request = async args => {
    if (args.method === 'personal_sign') { provider.calls.push(args); return '0x' + 'a'.repeat(130); }
    return original(args);
  };
  await wallet.connect(provider);
  for (const change of [{origin:'https://other.example'}, {address:other}, {tokenAddress:other}, {roundId:2}, {message:base.message + ' changed'}, {endsAt:base.endsAt + 1000}, {nonce:'bad'}]) {
    const entry = {...base,...change};
    await assert.rejects(wallet.signEntry(entry, {...settings,targetRoundId:1}, base.origin), /details changed/);
  }
  assert.equal(provider.calls.filter(c => c.method === 'personal_sign').length, 0);
  await wallet.signEntry(base, {...settings,targetRoundId:1}, base.origin);
  const sign = provider.calls.find(c => c.method === 'personal_sign');
  assert.equal(Buffer.from(sign.params[0].slice(2), 'hex').toString('utf8'), base.message);
  assert.equal(sign.params[1], address);
  provider.request = async args => {
    if (args.method === 'personal_sign') {
      provider.accounts = [other]; provider.emit('accountsChanged', [other]);
      return '0x' + 'b'.repeat(130);
    }
    return original(args);
  };
  await assert.rejects(wallet.signEntry(base, {...settings,targetRoundId:1}, base.origin), /wallet changed/);
});
