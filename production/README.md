# Moving APEX from prelaunch to live competition

The public release has real EIP-1193 browser-wallet connection, EIP-6963 wallet selection, explicit Robinhood Chain switching and a read-only ERC-20 balance adapter. No wallet extension is contacted for account permission until the visitor selects it. No signatures, approvals or transfers are requested by this release. Connecting an address is not authentication and is not registration.

Robinhood Chain mainnet settings (chain ID 4663, ETH gas, RPC and explorer) were checked on 2026-09-11 against the official documentation:
- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/add-network-to-wallet/
- https://eips.ethereum.org/EIPS/eip-1193
- https://eips.ethereum.org/EIPS/eip-6963
- https://eips.ethereum.org/EIPS/eip-20
- https://eips.ethereum.org/EIPS/eip-3085
- https://eips.ethereum.org/EIPS/eip-3326

The public RPC is suitable for adding the network to a wallet. Robinhood's documentation recommends a dedicated provider for production indexing. Do not put a private provider API key in browser files.

## Launch dependencies

1. **Token:** the owner will supply the final $APEX address from pons. `scripts/configure-token.mjs` verifies the chain, contract and ERC-20 metadata and can generate the single public `dist/lib/access-token.js` file. The active address is deliberately null. See `TOKEN.md` for the verified inspection and activation flow. The balance adapter reads one block and compares integers exactly; an authoritative backend must repeat the check when accepting entries. The example token was inspected successfully read-only; actual $APEX balances remain untested until its final address is supplied.
2. **Schedule and rules:** confirm a first-round timestamp with timezone and the exact 24-hour schedule across daylight-saving transitions. Confirm approved assets/venues, minimum portfolio, holding period, treatment of $APEX, ties, valuation method, payout currency and fee source, fewer-than-ten and zero-winner handling, and review/payment timing. The prelaunch page does not invent these values.
3. **Registration service and durable storage:** use server time, a short-lived round-scoped nonce, a readable signed message bound to the canonical domain/URI, chain, wallet and intended round, verified signatures, replay protection and a unique `(round_id, wallet)` database constraint. Recheck the time window and a trusted RPC balance inside the acceptance flow. A wallet readout in the browser is never proof of eligibility. Add request limits, an auditable registration record and database backups before opening entry.
4. **Trade ingestion and valuation:** choose an archive/indexing provider for eligible venues and price observations. Track trades, token transfers, ETH flows and open positions with canonical block references. Exclude external cash flows with an explicitly chosen methodology, handle stale/illiquid quotes, reorgs and finality, and retain the input evidence for result review. Do not implement raw ETH-balance growth as trading return.
5. **Finalization and payment:** result review, final rankings and confirmed payments are distinct states. No payout contract or signing key is needed for this prelaunch release. Do not implement or execute payment based on unresolved rules. Mark Paid only from a confirmed onchain receipt for the intended distribution.

## Current boundaries

- There is no registration endpoint, authoritative round service, indexer, result database or payout service yet. Changing `demo` or `stage` cannot enable them.
- The website shows an unstarted arena, no invented countdown or pool and no fabricated history. Historical demo adapters are retained only under `tests/fixtures/`, outside the deployed directory.
- Browser extension wallets and compatible in-wallet browsers can expose an injected provider. WalletConnect/QR connections are not implemented.
- The available QA browser had no wallet extension. Automated provider tests cover permission rejection, wrong network, add/switch behavior, exact balances, changed accounts/networks, malformed responses and late responses. Real extension approval and actual token reads still need to be verified with the supplied token.
- Browser checks covered desktop and 390×844 mobile layouts, wallet-not-installed guidance, dialog close/retry, search and FAQ, with no horizontal overflow or console errors observed.

The previous demo is preserved in Git and the prior VPS release for rollback; it is not available through a public demo switch.
