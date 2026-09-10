# Initial APEX activation

Owner-approved contract: `0xfb57c3f37c6122817981c8ac94b24a1b844f766a`.
Verified on Robinhood Chain (4663): Apex / APEX, 18 decimals, 1 billion total supply.

The operator activated this contract on the owner's VPS after explicit instruction.

- Registration opened: **2026-09-10 23:34:42.002 UTC** (September 11, 03:34:42 Asia/Tbilisi).
- First round starts / registration closes: **2026-09-11 00:04:42.002 UTC** (September 11, 04:04:42 Asia/Tbilisi).
- First round ends: **2026-09-12 00:04:42.002 UTC**.
- Stored activation epoch: `1789083282002`.
- Application release: `55a7ba576d0869abea1416e84292917801551eb6`.

The main timer counts down registration, then the round. The live database and `/api/arena` are authoritative; this document records the initial activation and is not a timer reset mechanism.

Validation: 34 automated tests passed. Disposable local browser tests verified the same main timer in registration and live modes, reload persistence, desktop and mobile layouts. After activation the VPS preview displayed Registration open and the decreasing main timer with no console errors. Public HTTPS `/api/arena` confirmed the exact token, activation timestamp and open registration; public `app.js` matched the deployed bytes. The database path returned 404 publicly.

A consistent, integrity-checked SQLite launch snapshot was saved privately at `/root/backups/apex-launch-20260910T233442Z/arena.sqlite`. Deployment rollback files are at `/root/backups/apex-20260910T233348Z`. Keep all database backups private and retain newer entries during any code rollback.

Portfolio ingestion, result calculation and payouts are not connected. The owner was informed before activation. Real extension signing has not been exercised in the QA browser, which has no wallet extension. No test wallet was registered on production and no token transaction or payment was sent.
