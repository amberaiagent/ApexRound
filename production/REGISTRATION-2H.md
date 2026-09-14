# First registration extended to two hours

The owner requested a two-hour first registration period. Deployed at **2026-09-14 21:36:04 UTC**, before the original first-round deadline.

- Live frontend/API release: `d8eb252b7419cf07beeee80a2265fddfdecb047f`.
- Private pre-deployment database/configuration backup: `/root/backups/apex-20260914T213604Z/`.
- Archive SHA-256: `bf4e693cd3c0b3bde7d0bc60124c03c92718db55e8e5a3fdf5bd6074ca6dbd76`.
- Existing activation retained: `1789420257927` / `2026-09-14T21:10:57.927Z`.
- New registration deadline / round #1 start: `1789427457927` / **2026-09-14T23:10:57.927Z** / **September 15, 03:10:57.927 Asia/Tbilisi**.
- First round end: `1789513857927` / `2026-09-15T23:10:57.927Z`.
- Active CA unchanged: `0xe75333533f47d5109f2343d306061efdd14b9ddf`; access remains 5M $ARENA.

The API, browser, round directory, guide, rules and FAQ use the two-hour first period. Later rounds still last 24 hours, with entry during the preceding round's final hour. The main timer now includes hours. Both browser dependency chains have new cache versions; already-open pages must be reloaded to obtain the revised schedule code.

All 80 tests passed. Coverage includes exact closure at two hours from the original activation, continued registration at the former 30-minute boundary, 24-hour rollover, the later one-hour window, and rejection of unexpired signatures bound to the former schedule. Frozen legacy signed bytes remain unchanged in compatibility fixtures. No actual user entry or signature was fabricated for verification.

Immediately before deployment, the public launch had zero confirmed entries. The installer retained the existing database and made an online SQLite backup. After deployment the API confirmed the same activation/token, open registration, and the exact revised start/end times. No activation CLI was invoked. No test wallets or organizer entries were added to the live database or counter.

Public verification at 21:36:46 UTC confirmed two no-store API responses with increasing server time and an unchanged activation timestamp. All 12 checked public files (eight pages and four schedule-related modules) matched the release byte for byte. All six SQLite tables matched the pre-deployment snapshot exactly; integrity and foreign-key checks passed. Browser verification displayed `REGISTRATION OPEN`, `01:34:09` remaining and the revised `03:10 local` start time.

Preserve the current database during future releases. Rolling back schedule code to the old release would also restore the superseded 30-minute calculation; keep the owner-approved two-hour policy when preparing a rollback. Never restore an old database to change a countdown.
