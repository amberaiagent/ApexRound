// Standard ERC-20 read methods only. This module cannot sign or send transactions.
const WORD = /^0x[0-9a-f]{64}$/i;
const HEX = /^0x(?:[0-9a-f]{2})+$/i;
const HASH = /^0x[0-9a-f]{64}$/i;

export function normalizeAddress(value) {
  if (typeof value !== 'string') throw Error('Provide the token contract address.');
  // Allow whitespace left by copying from rich text, but never extract a guessed
  // address from a URL, sentence, pool address list or arbitrary input.
  const address = value.replace(/(?:\s|&nbsp;|&#32;|&#x20;)+$/gi, '').trim();
  if (!/^0x[0-9a-f]{40}$/i.test(address) || /^0x0{40}$/i.test(address)) {
    throw Error('Expected a nonzero 0x address containing exactly 40 hexadecimal characters.');
  }
  return address.toLowerCase();
}

export function uint256(value, label) {
  if (typeof value !== 'string' || !WORD.test(value)) throw Error('Invalid ' + label + ' response.');
  return BigInt(value);
}

export function decodeText(value, label) {
  if (typeof value !== 'string' || !HEX.test(value)) throw Error('Invalid ' + label + ' response.');
  const bytes = Buffer.from(value.slice(2), 'hex');
  let content;
  if (bytes.length === 32) {
    // Some ERC-20 contracts return bytes32 metadata instead of a dynamic string.
    const zero = bytes.indexOf(0);
    content = bytes.subarray(0, zero === -1 ? bytes.length : zero);
  } else {
    if (bytes.length < 64 || uint256('0x' + bytes.subarray(0, 32).toString('hex'), label) !== 32n) {
      throw Error('Invalid ' + label + ' ABI offset.');
    }
    const length = uint256('0x' + bytes.subarray(32, 64).toString('hex'), label);
    if (length > 256n || bytes.length < 64 + Math.ceil(Number(length) / 32) * 32) {
      throw Error('Invalid ' + label + ' ABI length.');
    }
    content = bytes.subarray(64, 64 + Number(length));
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(content).trim();
  if (!text || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(text)) {
    throw Error('Invalid ' + label + ' text.');
  }
  return text;
}

export function makeRpc(endpoint, fetchImpl = fetch) {
  let url;
  try { url = new URL(endpoint); } catch { throw Error('RPC endpoint is invalid.'); }
  if (url.protocol !== 'https:') throw Error('RPC endpoint must use HTTPS.');
  let sequence = 0;
  return async (method, params = []) => {
    if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_call'].includes(method)) {
      throw Error('Only read-only token inspection methods are allowed.');
    }
    const id = ++sequence;
    let response, data;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw Error('HTTP failure');
      data = await response.json();
    } catch {
      // Do not echo provider URLs/errors: an operator-supplied endpoint may contain a key.
      throw Error('RPC request failed for ' + method + '. Check connectivity or use APEX_RPC_URL.');
    }
    if (data?.jsonrpc !== '2.0' || data.id !== id || data.error || !Object.hasOwn(data, 'result')) {
      throw Error('RPC could not verify ' + method + '. Token configuration was not changed.');
    }
    return data.result;
  };
}

export async function inspectToken({ address: input, rpc, chainId = 4663, required = 10000000n }) {
  const address = normalizeAddress(input);
  const actualChain = await rpc('eth_chainId');
  if (typeof actualChain !== 'string' || !/^0x[0-9a-f]+$/i.test(actualChain) || BigInt(actualChain) !== BigInt(chainId)) {
    throw Error('RPC is not connected to the expected Robinhood Chain network.');
  }
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || !/^0x[0-9a-f]+$/i.test(block.number) || !HASH.test(block.hash)) throw Error('Cannot verify the current block.');
  const code = await rpc('eth_getCode', [address, block.number]);
  if (typeof code !== 'string' || !HEX.test(code) || /^0x0*$/i.test(code)) {
    throw Error('No contract exists at this address on Robinhood Chain.');
  }
  const read = data => rpc('eth_call', [{ to: address, data }, block.number]);
  const [rawDecimals, rawName, rawSymbol, rawSupply, rawBalance] = await Promise.all([
    read('0x313ce567'), read('0x06fdde03'), read('0x95d89b41'), read('0x18160ddd'),
    // A read against the zero address checks the balanceOf interface, not ownership.
    read('0x70a08231' + '0'.repeat(64)),
  ]);
  const decimalValue = uint256(rawDecimals, 'decimals');
  if (decimalValue > 255n) throw Error('Token decimals are outside the ERC-20 range.');
  const decimals = Number(decimalValue), supply = uint256(rawSupply, 'totalSupply');
  uint256(rawBalance, 'balanceOf');
  if (required <= 0n || supply < required * 10n ** decimalValue) {
    throw Error('Token supply is below the required 10,000,000-token access threshold.');
  }
  const name = decodeText(rawName, 'name'), symbol = decodeText(rawSymbol, 'symbol');
  const confirmed = await rpc('eth_getBlockByNumber', [block.number, false]);
  const confirmedChain = await rpc('eth_chainId');
  if (confirmed?.hash?.toLowerCase() !== block.hash.toLowerCase() || confirmedChain !== actualChain) {
    throw Error('Chain state changed during verification. Retry before activating the token.');
  }
  return {
    chainId, address, decimals, name, symbol, totalSupply: supply.toString(),
    verifiedAt: new Date().toISOString(), verifiedBlock: block.number, verifiedBlockHash: block.hash,
  };
}
