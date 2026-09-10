// Public configuration only. Never put an RPC API key or a private key here.
// Network parameters: https://docs.robinhood.com/chain/connecting/
import { accessToken } from './access-token.js';

if (accessToken.chainId !== 4663) throw new Error('Access token network does not match Robinhood Chain.');
if (accessToken.address !== null && (!/^0x[0-9a-f]{40}$/i.test(accessToken.address)
    || /^0x0{40}$/i.test(accessToken.address) || !Number.isInteger(accessToken.decimals)
    || accessToken.decimals < 0 || accessToken.decimals > 255)) {
  throw new Error('Invalid access token configuration.');
}
export const config = Object.freeze({
  demo: false,
  ticker: '$APEX',
  required: 10000000n,
  tokenAddress: accessToken.address,
  decimals: accessToken.decimals,
  roundMs: 86400000,
  windowMs: 3600000,
  timezone: 'America/New_York',
  network: Object.freeze({
    chainId: '0x1237',
    chainName: 'Robinhood Chain',
    nativeCurrency: Object.freeze({ name: 'Ether', symbol: 'ETH', decimals: 18 }),
    rpcUrls: Object.freeze(['https://rpc.mainnet.chain.robinhood.com']),
    blockExplorerUrls: Object.freeze(['https://robinhoodchain.blockscout.com']),
  }),
});

export const pending = [
  'Fee source and payout currency',
  'Minimum portfolio, eligible assets and trading venues',
  'Portfolio valuation and treatment of external transfers',
  'Tie-breaking',
  'Result review and payment timing',
  'Whether 10M $APEX must be held throughout the round',
  'Distribution with fewer than ten or no qualifiers',
  'Whether $APEX is included in the trading portfolio',
];
