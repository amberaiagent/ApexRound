# ARENA launch record

## Owner-approved ARENA activation

The owner supplied and authorized final CA `0xe75333533f47d5109f2343d306061efdd14b9ddf`. It was activated on `https://arenarounds.xyz` through the existing operator CLI, without a code deployment or timer reset.

- Network: Robinhood Chain mainnet, chain ID `4663`.
- Verified metadata: **Arena Rounds / ARENA**, 18 decimals, 1 billion total supply.
- Access requirement: **5,000,000 $ARENA**, registration message version 3.
- Registration opened: **2026-09-14 21:10:57.927 UTC** (September 15, **01:10:57.927 Asia/Tbilisi**).
- Registration closes / round #1 starts: **2026-09-14 21:40:57.927 UTC** (September 15, **01:40:57.927 Asia/Tbilisi**).
- First 24-hour round ends: **2026-09-15 21:40:57.927 UTC**.
- Stored activation epoch: `1789420257927`; first round start epoch: `1789422057927`.
- Application release: `441902a5f8af25c682b62a5b734a69148e55b15f`.
- Private consistent pre-activation SQLite snapshot, before/after API state and activation receipt: `/root/backups/arena-activate-20260914T211050Z/`.

Inspection verified chain, contract bytecode, ERC-20 methods, decimals, metadata, supply and block consistency. A separate freshness check measured the current RPC block age at approximately 1.35 seconds. Activation repeated the contract inspection before setting the timestamp. Immediate API checks confirmed the exact CA, open registration, upcoming round #1, a 30-minute entry period and a 24-hour first round. SQLite integrity and foreign-key checks passed; all retired archive rows remained byte-for-byte unchanged. No production test entry, wallet signature or token transaction was created.

Two public HTTPS API reads confirmed `no-store`, the exact CA, a stable activation timestamp and increasing server time. Public arena/token pages used the current 5M scripts. Browser verification on the new domain showed `REGISTRATION OPEN`, round `#001`, the main timer decreasing from `29:22`, and the exact CA with its copy control and explorer link on `/token/`.

The live database and `/api/arena` remain authoritative. Repeat activation of this same CA must retain the timestamp; preserve the database and retirement archives during every future deployment. Portfolio ingestion, valuation, rankings and payouts remain separate unfinished work; this activation enables the agreed schedule and registration.

## Retired initial APEX activation

On **2026-09-14 15:33:20.802 UTC**, the operator retired the old access contract at the owner's request. Immediately afterward `/api/arena` returned `phase: prelaunch`, with `token`, `activatedAt`, `current`, `next` and `registration` all null. The following details record that historical retirement, before the replacement ARENA launch above.

- Retirement archive ID: `1`; epoch: `1789400000802`.
- Deployed frontend and API release: `456358db3efd6c96f08b3ceaab16e9dc5603f9ae`.
- The original launch's exact metadata and activation time are retained in `retired_launches`. There were zero entries and zero challenges to archive.
- Private snapshots before and after retirement, plus the operator receipt: `/root/backups/arena-retire-20260914T153320Z/`.
- Additional preflight snapshot: `/root/backups/arena-preflight-20260914T153115Z/before.sqlite`.
- Deployment rollback files and database snapshot: `/root/backups/apex-20260914T153308Z/`.
- Both retirement snapshots passed SQLite integrity checks; the final database passed foreign-key checks and has no active launch, entries or challenges.
- 75 automated tests passed. Public HTTPS confirmed the prelaunch state and no-store API response. The served transparent PNG favicon matched the local asset byte for byte.

For a code rollback, preserve the **current database including retirement archives**. Restoring a pre-retirement database would reactivate the old contract. The details below are a historical record only.

## Historical activation

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
