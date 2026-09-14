# ARENA — Your edge. Your arena.

The public brand and displayed access ticker are **ARENA / $ARENA**, with the supplied logo, `#f4f4f4` background and `#7d6db3` accent. The interface uses large sans-serif typography and geometric layouts. The previous access token has been retired at the owner's request; the interface is waiting for a new contract. Registration messages use the ARENA brand and a persisted message version. For a design-only update, use `deploy/static.py` as documented in `deploy/README.md`; signature or API changes require the full installer.

## Run locally

Decorative motion is isolated in `dist/motion.js`, `dist/motion.css` and `dist/interactions.css`: independently floating rings, pointer response, scroll entrances and finite UI feedback. The shared footer's motion control remembers a local pause preference; reduced-motion settings are respected, and the rings stop while offscreen or in a hidden tab. All pages remain readable without this enhancement.

Double-click `START-APEX.cmd`, or run `npm ci` once, then `npm run build` and `npm start` and open http://127.0.0.1:4173. Node 22.12+ is required locally; Node 24 runs the VPS service. Edit HTML in `site/`, then run `npm run build` to generate the eight static pages in `dist/`. Browser scripts and styles are authored in `dist/`. There is no ChatGPT sign-in or framework dependency.

Run `npm run build` and `npm test` before delivery. Tests also verify generated pages, links, directory filters and cross-page wallet continuity.

## Pages
- `/`: concise brand homepage with a live round summary.
- `/arena/`: round clock, actual registration counts and entry panel.
- `/rounds/`: search, status filters and pagination across scheduled rounds.
- `/rounds/view/?round=N`: individual round timing and result status.
- `/my-arena/`: wallet identity, eligibility actions and confirmed entries.
- `/guide/`: onboarding chapters and common questions.
- `/token/`: access requirement, exact contract copy and explorer link.
- `/rules/`: confirmed format and clearly identified pending terms.

Navigation uses real documents and works with direct links and refresh. Old `#arena`, `#how` and `#history` bookmarks redirect to their new pages. A previously selected wallet can resume through read-only `eth_accounts`; navigation never requests permissions, signs, checks balances or registers automatically. Live fields on all pages use the same authoritative API and schedule. Past trading windows do not imply verified results.

## Delivery
Source: https://github.com/amberaiagent/ApexRound, branch `main`.
Website: https://apex-round.com, on the owner's VPS with HTTPS.
`OPEN-VPS-PREVIEW.cmd` opens the same VPS release through SSH at http://127.0.0.1:4174.

Delivery is manual: pushing to GitHub does not deploy. See `deploy/README.md`. Only `dist/` is served as files; the registration API runs separately. Development stays local. Do not publish or update the previous Sites-hosted copy.

## Current release
The owner is replacing the access token. Public token metadata is empty, the previous launch is archived by the operator, and `/api/arena` is the authority for the current token and launch. Until a new CA is explicitly supplied and activated, registration remains closed. No placeholder address is installed.

- The **existing main arena timer** starts at **30:00** when the operator activates the owner's final CA on the server. Registration opens immediately.
- At zero, registration closes and **the same timer** counts down the first 24-hour round. Later rounds accept entries during the current round's final hour.
- Activation is stored once in SQLite. Page reloads, repeated activation of the same CA and service restarts do not reset it.
- Wallet connection and balance checking are separate from entry. Joining explicitly signs a readable, single-round message. The server verifies the signature, nonce, deadline and exact 5,000,000-token balance through a trusted RPC.
- No token approvals, transfers, locking or payment keys are involved.
- Portfolio ingestion, valuation, live results and payouts are still pending. This release prepares timing and registration, not the completed trading/results system.

See `production/TOKEN.md` for final-token activation and `production/README.md` for remaining launch dependencies.

## Structure
- `site/layout.html`, `site/pages/`, `site/components/`: shared layout, page content and components.
- `scripts/build-site.mjs`: deterministic, dependency-free static page generator.
- `dist/style.css`, `pages.css`, `site.js`: shared visual primitives, page layouts and navigation.
- `dist/app.js`: optional page-bound state fields, wallet UI and API synchronization.
- `dist/rounds.js`, `dist/lib/round-directory.js`: real schedule directory and detail views.
- `dist/lib/schedule.js`: shared 30-minute / 24-hour schedule.
- `dist/lib/wallet.js`, `entry-message.js`: injected wallet and explicit entry signature.
- `api/`: authoritative schedule, SQLite entries, trusted balance checks, operator activation CLI.
- `scripts/configure-token.mjs`: read-only token inspection by default; optional metadata export is not server activation.
- `data/`: local private database, ignored by Git.
- `tests/fixtures/`: historical demo fixtures, never deployed.

## Validation
Automated tests cover timer boundaries, durable activation, signature verification, replay/duplicate rejection, late entries, exact balances, stale RPC/reorgs, HTTP restrictions, deterministic page generation, internal links, directory filters, detail IDs, partial DOM layouts and read-only wallet continuity. Browser QA covers desktop/mobile navigation, FAQ, wallet dialog and live round views. The final contract passed real read-only RPC inspection. The QA browser has no installed wallet; actual extension signing remains unverified.
