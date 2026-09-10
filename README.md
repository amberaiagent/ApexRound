# APEX — Earn your place

Run `node server.js` and open http://127.0.0.1:4173. No installation or build is required. Run `node --test tests/arena.test.js` for boundary checks. The complete deployable site is in `dist/`.

## Scope
English responsive arena with supplied APEX icon, wallet simulation, separate integer balance check and registration, 24-hour rollover, leaderboard/search, personal results, previous rounds, rules, and demo scenario studio. Both original logo files are preserved in `dist/assets`. The wordmark is dark in the provided image; the dark header combines the original icon with a readable typeset name.

All balances, competition results, entries and allocations are demo data. State is local to the current page and resets on reload. No wallet extension is contacted and no signatures, token approvals, real transactions or payouts occur. Do not enable this as production merely by changing the demo flag.

## Architecture and production dependencies
`lib/config.js` holds unresolved integration and rule settings. `lib/rounds.js` is the pure clock/eligibility policy. `lib/providers.js` separates wallet, balance, registration, result and payout providers. `app.js` composes UI state. Token balances and ETH amounts use BigInt; return uses millionths of a percentage point. Display rounding never controls qualification.

Replace demo adapters with verified integrations only after confirming token address, ticker, decimals, contract addresses, chain ID, RPC, explorer and wallet support from official documentation. Network configuration is intentionally unset. Define fee source, payout currency, minimum portfolio, eligible venues/assets, tie-breaker, continuous holding requirement, verification/payment timing, eligibility token inclusion, fewer-than-ten and zero-winner policies.

Production registration needs authoritative server/contract time, a round-scoped nonce and expiry, human-readable signed entry message, wallet signature verification, chain and balance validation, replay protection, and a durable unique constraint on (roundId, wallet). Recheck entry window on acceptance. Local demo entries are intentionally not a security boundary.

A production result provider must ingest trades, transfers and open positions with stable block references. Value the entire eligible portfolio in ETH using approved price sources and observation times; remove external deposit/withdrawal effects using an agreed cash-flow-adjusted methodology. Define illiquid/stale quotes, manipulation checks, reorg/finality handling, decimals, and inclusion of TOKEN. Do not compare raw starting/ending ETH balances. Archive valuation inputs for reproducible review. Resolve ties and disputed data before finalization.

Payout records must be separate from result finalization, and require confirmed chain receipts before Paid is displayed. No distribution contract is implemented. Explorer links require both a configured explorer and real hash. Current demo history is finalized but unpaid.

Demo schedule anchors to noon in America/New_York, then uses exact 86,400,000ms rounds. ET and device-local times are displayed. A fixed noon ET schedule cannot also preserve 24-hour rounds at DST boundaries: choose and document a production policy before launch. User device time is only acceptable in this marked simulation.

## QA
Automated checks cover entry-window boundaries, rollover, strict +50%, precision, top-ten qualification, ten equal shares, duplicate/stale entry, insufficient balance, and winter/summer ET offsets. Browser verification is recorded in the delivery message. WebMCP exposes read_arena and set_demo_scenario using the same state as the UI.

