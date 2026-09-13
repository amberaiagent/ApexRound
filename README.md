# ARENA — Your edge. Your arena.

The public brand is now **ARENA**, with the supplied logo, `#f4f4f4` background and `#7d6db3` accent. The interface uses large sans-serif typography and geometric layouts. The deployed access token remains `$APEX` at the owner-approved contract below; its onchain name, signed-message format and stored launch time are unchanged. For a design-only update, use `deploy/static.py` as documented in `deploy/README.md`.

## Run locally
Double-click `START-APEX.cmd`, or run `npm ci` once, then `npm start` and open http://127.0.0.1:4173. Node 22.12+ is required locally; Node 24 runs the VPS service. The authored website is in `dist/`. There is no ChatGPT sign-in or frontend build.

Run `npm test` for the rule, wallet, token inspection and registration tests.

## Delivery
Source: https://github.com/amberaiagent/ApexRound, branch `main`.
Website: https://apex-round.com, on the owner's VPS with HTTPS.
`OPEN-VPS-PREVIEW.cmd` opens the same VPS release through SSH at http://127.0.0.1:4174.

Delivery is manual: pushing to GitHub does not deploy. See `deploy/README.md`. Only `dist/` is served as files; the registration API runs separately. Development stays local. Do not publish or update the previous Sites-hosted copy.

## Current release
The owner-approved token is **Apex / APEX**, Robinhood Chain, contract **0xfb57c3f37c6122817981c8ac94b24a1b844f766a**, 18 decimals. Live activation and phase are authoritative in the server database and visible at `/api/arena`. No sample CA, fabricated traders, pool or results are installed.

- The **existing main arena timer** starts at **30:00** when the operator activates the owner's final CA on the server. Registration opens immediately.
- At zero, registration closes and **the same timer** counts down the first 24-hour round. Later rounds accept entries during the current round's final hour.
- Activation is stored once in SQLite. Page reloads, repeated activation of the same CA and service restarts do not reset it.
- Wallet connection and balance checking are separate from entry. Joining explicitly signs a readable, single-round message. The server verifies the signature, nonce, deadline and exact 10,000,000-token balance through a trusted RPC.
- No token approvals, transfers, locking or payment keys are involved.
- Portfolio ingestion, valuation, live results and payouts are still pending. This release prepares timing and registration, not the completed trading/results system.

See `production/TOKEN.md` for final-token activation and `production/README.md` for remaining launch dependencies.

## Structure
- `dist/index.html`, `style.css`, `app.js`: public interface.
- `dist/lib/schedule.js`: shared 30-minute / 24-hour schedule.
- `dist/lib/wallet.js`, `entry-message.js`: injected wallet and explicit entry signature.
- `api/`: authoritative schedule, SQLite entries, trusted balance checks, operator activation CLI.
- `scripts/configure-token.mjs`: read-only token inspection by default; optional metadata export is not server activation.
- `data/`: local private database, ignored by Git.
- `tests/fixtures/`: historical demo fixtures, never deployed.

## Validation
34 automated tests cover timer boundaries, durable activation, signature verification, replay/duplicate rejection, late entries, exact balances, stale RPC/reorgs, HTTP restrictions and existing wallet/rule checks. Browser QA covers the main timer and registration-to-live transition. The final contract passed real read-only RPC inspection. The QA browser has no installed wallet; actual extension signing remains unverified.
