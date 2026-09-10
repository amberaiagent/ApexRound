// Public configuration only. Never put an RPC API key or a private key here.
// Network parameters: https://docs.robinhood.com/chain/connecting/
export const config = Object.freeze({
  stage: 'prelaunch',
  demo: false,
  ticker: '$APEX',
  required: 10000000n,
  tokenAddress: null,
  decimals: null,
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
  'First round start and daily schedule',
  'Fee source and payout currency',
  'Minimum portfolio, eligible assets and trading venues',
  'Portfolio valuation and treatment of external transfers',
  'Tie-breaking',
  'Result review and payment timing',
  'Whether 10M $APEX must be held throughout the round',
  'Distribution with fewer than ten or no qualifiers',
  'Whether $APEX is included in the trading portfolio',
];
