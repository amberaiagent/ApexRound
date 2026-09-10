# APEX — Earn your place

## Run locally
Double-click `START-APEX.cmd`, or run `node server.js` and open http://127.0.0.1:4173. All files are on this computer. No ChatGPT sign-in, installation or build is required. The authored website is in `dist/`.

Run `node --test tests/arena.test.js tests/wallet.test.js` to check wallet behavior and the existing competition policy.

## Delivery
Source: https://github.com/amberaiagent/ApexRound, branch `main`.
Website: https://apex-round.com, on the owner's VPS with HTTPS.
`OPEN-VPS-PREVIEW.cmd` opens the VPS through the existing SSH tunnel at http://127.0.0.1:4174.

Delivery is manual: a GitHub push does not deploy. See `deploy/README.md` for releases, certificates and rollback. Only `dist/` is published. Keep local runtime files, secrets, archives, SSH keys, tests and old hosting metadata out of the public release.

Development stays local and deployment uses GitHub and the owner's VPS. Do not publish or update the previous Sites-hosted copy.

## Current release: prelaunch
The public page no longer uses simulated wallets, traders, pools, countdowns or history. It shows the first round as not started.

- Real browser-wallet discovery/connection and explicit Robinhood Chain switching.
- Read-only ERC-20 balance adapter with exact integer arithmetic, block-specific reads, contract/decimals checks and invalidation when the account or chain changes.
- The token address and decimals are not configured, so balance checks remain unavailable.
- Registration is closed. There is no competition backend, trade ingestion, live ranking or payment service yet.
- No signatures, token approvals, token locking or payments are requested.
- The existing visual design, $APEX branding, responsive layouts and agreed competition rules remain.

This is a step toward the real service, not a completed production trading arena. See `production/README.md` for the concrete dependencies, sources and validation limits.

## Structure
- `dist/index.html`, `style.css`, `app.js`: public interface.
- `dist/lib/config.js`: public network/token configuration; never add secrets.
- `dist/lib/wallet.js`: wallet discovery, permission requests, network switching and informational token reads.
- `dist/lib/rounds.js`: previously tested pure round policy; no authoritative live schedule is activated.
- `tests/fixtures/demo-providers.js`: historical simulation fixtures, excluded from deployment.

Production entry acceptance must recheck time and balances on a trusted server or contract. User-device time, an address returned by an extension and a browser balance read cannot authorize an entry. Portfolio returns must exclude external funding and value open positions using agreed prices. Payment status must be based on confirmed receipts.

## Validation
16 automated tests cover the existing rule boundaries and new wallet integration. Desktop/mobile browser checks cover prelaunch state, absent-wallet guidance, dialog interaction, search and FAQ. The QA browser has no installed wallet: actual extension approval and $APEX onchain reads are still unverified. The contract address is required for that next step.
