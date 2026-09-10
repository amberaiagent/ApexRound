import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeAddress, decodeText, inspectToken, makeRpc } from '../scripts/lib/token-inspection.mjs';
import { saveToken, tokenModule, main } from '../scripts/configure-token.mjs';

const example = '0xec2976c9c9c5789c425584965c6780671b02792c';
const word = n => BigInt(n).toString(16).padStart(64, '0');
const abiText = value => {
  const hex = Buffer.from(value).toString('hex');
  return '0x' + word(32) + word(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
};
const hash = '0x' + 'a'.repeat(64);
function fixture({ decimals = 18, name = 'APEX', symbol = 'APEX' } = {}) {
  const calls = [];
  const rpc = async (method, params = []) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') return { number: '0x100', hash };
    if (method === 'eth_getCode') return '0x6080';
    if (method === 'eth_call') {
      const selector = params[0].data.slice(0, 10);
      return {
        '0x313ce567': '0x' + word(decimals),
        '0x06fdde03': abiText(name),
        '0x95d89b41': abiText(symbol),
        '0x18160ddd': '0x' + word(1000000000n * 10n ** BigInt(decimals)),
        '0x70a08231': '0x' + word(0),
      }[selector];
    }
    throw Error('Unexpected RPC method');
  };
  return { rpc, calls };
}

test('Accept a copied CA with trailing rich-text whitespace, reject malformed and zero addresses', () => {
  assert.equal(normalizeAddress(example + ' &#x20; '), example);
  assert.equal(normalizeAddress('  ' + example.toUpperCase() + '\n'), example);
  for (const value of ['0x' + '0'.repeat(40), example.slice(0, -1), example + '0', 'token ' + example, 'https://ponsfamily.com/' + example]) {
    assert.throws(() => normalizeAddress(value));
  }
});

test('Token metadata comes from the chosen contract and one block; decimals are not assumed', async () => {
  for (const decimals of [6, 18]) {
    const { rpc, calls } = fixture({ decimals });
    const result = await inspectToken({ address: example, rpc });
    assert.equal(result.address, example);
    assert.equal(result.chainId, 4663);
    assert.equal(result.decimals, decimals);
    assert.equal(result.symbol, 'APEX');
    assert.equal(result.verifiedBlockHash, hash);
    const reads = calls.filter(c => c.method === 'eth_call');
    assert.ok(reads.every(c => c.params[0].to === example && c.params[1] === '0x100'));
    assert.ok(calls.every(c => c.method.startsWith('eth_') && !/sign|send/i.test(c.method)));
  }
});

test('Wrong chain, absent code, invalid ERC-20 values, insufficient supply and reorg reject activation', async () => {
  for (const fault of ['chain', 'code', 'decimals', 'balance', 'supply', 'reorg']) {
    const { rpc: original } = fixture();
    let blocks = 0;
    const rpc = async (method, params) => {
      if (fault === 'chain' && method === 'eth_chainId') return '0x1';
      if (fault === 'code' && method === 'eth_getCode') return '0x';
      if (method === 'eth_call') {
        const selector = params[0].data.slice(0, 10);
        if (fault === 'decimals' && selector === '0x313ce567') return '0x' + word(256);
        if (fault === 'balance' && selector === '0x70a08231') return '0x01';
        if (fault === 'supply' && selector === '0x18160ddd') return '0x' + word(1);
      }
      if (fault === 'reorg' && method === 'eth_getBlockByNumber' && blocks++ === 1) return { number: '0x100', hash: '0x' + 'b'.repeat(64) };
      return original(method, params);
    };
    await assert.rejects(inspectToken({ address: example, rpc }), undefined, fault);
  }
});

test('ABI metadata decoder rejects invalid offsets, lengths and terminal control characters', () => {
  assert.equal(decodeText(abiText('APEX'), 'symbol'), 'APEX');
  assert.equal(decodeText('0x' + Buffer.from('APEX').toString('hex').padEnd(64, '0'), 'symbol'), 'APEX');
  for (const raw of ['0x', '0x' + word(64) + word(4) + '0'.repeat(64), '0x' + word(32) + word(10000000), abiText('\x1bAPEX')]) {
    assert.throws(() => decodeText(raw, 'name'));
  }
});

test('RPC client only permits reads and hides errors containing provider credentials', async () => {
  const rpc = makeRpc('https://rpc.example/private-key', async () => { throw Error('private-key'); });
  await assert.rejects(rpc('eth_sendTransaction'), /read-only/);
  await assert.rejects(rpc('eth_chainId'), error => !error.message.includes('private-key'));
  const mismatch = makeRpc('https://rpc.example/', async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 999, result: '0x1237' }) }));
  await assert.rejects(mismatch('eth_chainId'), /could not verify/);
});

test('Metadata is inert even if the onchain token name contains JavaScript-looking text', async () => {
  const { rpc } = fixture({ name: 'APEX "); throw Error("unexpected"); //' });
  const metadata = await inspectToken({ address: example, rpc });
  const module = await import('data:text/javascript;base64,' + Buffer.from(tokenModule(metadata)).toString('base64'));
  assert.deepEqual(module.accessToken, metadata);
  assert.equal(Object.isFrozen(module.accessToken), true);
});

test('Writing verified metadata is an atomic local operation and does not alter launch status', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'apex-token-config-'));
  const target = pathToFileURL(join(folder, 'access-token.js'));
  try {
    await writeFile(target, 'original');
    const { rpc } = fixture();
    const metadata = await inspectToken({ address: example, rpc });
    await saveToken(metadata, target);
    const saved = await readFile(target, 'utf8');
    assert.equal(saved, tokenModule(metadata));
    assert.doesNotMatch(saved, /stage|registration|privateKey/);
  } finally {
    await unlink(target);
    await rmdir(folder);
  }
});

test('CLI inspection defaults to no activation; the supplied example stays out of public config', async t => {
  const target = new URL('../dist/lib/access-token.js', import.meta.url);
  const before = await readFile(target, 'utf8');
  const { rpc } = fixture();
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result: await rpc(body.method, body.params) }) };
  });
  t.mock.method(console, 'log', () => {});
  await main([example]);
  assert.equal(await readFile(target, 'utf8'), before);
  assert.doesNotMatch(before, new RegExp(example));
});
