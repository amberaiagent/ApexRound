# ARENA production readiness

## Implemented
- Real EIP-1193 browser-wallet connection, EIP-6963 wallet selection and explicit Robinhood Chain switching. Account permission is requested only when the visitor selects a wallet.
- Operator-only final-token activation, trusted ERC-20 inspection and durable SQLite launch time.
- One shared main timer: two hours of registration, then 24-hour trading rounds. Later registration opens in the current round's final hour. UTC durations remain exact across daylight-saving changes; displayed dates also show ET and local time.
- Registration API with readable EIP-191 signatures bound to the origin, chain, wallet, token and round, expiring random nonces, server-time deadlines, exact trusted RPC balance checks, replay protection and a unique round/wallet database constraint.
- Rate/body/concurrency limits, no-store API responses, durable entry receipts and RPC block references. No public activation endpoint.
- Private server database outside the web root and Git, with backup procedure in `deploy/README.md`.

The previous access token is retired. The owner's replacement ARENA contract `0xe75333533f47d5109f2343d306061efdd14b9ddf` was verified and activated at `2026-09-14T21:10:57.927Z`, opening the first two-hour registration period. See `LAUNCH.md` and `TOKEN.md`; `/api/arena` reports the actual activation and phase. Connecting and reading a balance request no signature; joining requests an explicit registration-message signature. No approval, payment, staking or private signing key is used.

## Work still required before a completed trading competition
1. **Final rules:** eligible assets/venues, minimum portfolio, required holding period, treatment of $ARENA, tie-breaking, valuation method, fee source/payout currency, fewer-than-ten and zero-winner handling, review/payment timing.
2. **Trade ingestion and valuation:** choose a production indexing/archive provider. Track trades, token transfers, ETH flows and open positions with canonical block references. Exclude external cash flows using an agreed method; handle stale/illiquid prices, reorgs and finality. Do not use raw ETH-balance growth as trading return.
3. **Finalization/payment:** review results, finalize rankings, then record independently confirmed onchain payments. Never mark a round Paid without its actual receipt.
4. **Operations:** arrange off-server retention of database backups and exercise restoration before opening real entries. Verify the owner's real wallet and final token. The public RPC can serve initial balance checks; indexing needs an appropriate dedicated provider.

The UI does not fabricate rankings, pools or completed rounds. Activating the timer does not implement the missing portfolio/results pipeline. Browser extension wallets and compatible in-wallet browsers work through injected providers; WalletConnect/QR is not implemented.

## Verification
34 automated tests cover boundaries, durable restart/idempotence, signed registration, wrong signer/origin, expiry/replay/duplicates, deadline crossing during RPC, exact balance thresholds, stale data/reorgs, HTTP limits and wallet state changes. Local browser QA exercises the same main timer in registration/live modes and reload persistence using a disposable in-memory fixture, never the production database. Actual extension signing remains unverified; final-token metadata was verified via the real RPC.

## Primary references
- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/add-network-to-wallet/
- https://docs.ponsfamily.com/
- https://eips.ethereum.org/EIPS/eip-1193
- https://eips.ethereum.org/EIPS/eip-6963
- https://eips.ethereum.org/EIPS/eip-191
- https://eips.ethereum.org/EIPS/eip-20
- https://docs.ethers.org/v6/api/hashing/#verifyMessage
