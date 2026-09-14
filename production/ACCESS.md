# Five-million-token access requirement

The owner approved reducing access from 10,000,000 to **5,000,000 $ARENA** on 2026-09-14.

Deployed at approximately **2026-09-14 17:13 UTC**, on the existing `https://apex-round.com` domain while registry DNS for the planned new domain remains pending.

- Live frontend and API release: `3049065271a95e6795bd7ed303b158b4b08dcd5a` (`codex/five-million`).
- Equivalent access change on main: `2b6c63cfa25e55330e5527dfc2db6032c767bf00`; main also contains the uncompleted domain migration.
- Private pre-update configuration/database backup: `/root/backups/apex-20260914T171311Z/`.
- Shared current requirement: `5000000n`; new signed registration messages use version 3. Versions 1 and 2 retain immutable 10M signed text and their original threshold for any unexpired old request.
- 78 automated tests passed on both main and the live branch. Real-signature HTTP tests verify exact 5M acceptance and rejection one atomic unit below; wallet and token-inspection boundary checks passed.
- All eight served page files and five changed browser modules matched the live release through the VPS preview. Public browser checks confirmed 5M on the arena and token pages.
- The running container reported the 5M requirement, version 3, and an empty token address. The API remained in prelaunch with no activation timestamp.
- All six active/archive database tables matched the pre-update snapshot exactly, with SQLite integrity and foreign-key checks passing. One retired launch remains preserved; active launch, entries and challenges remain empty.

The staged HTTP validation host for `arenarounds.xyz` was retained. No token activation, wallet transaction or production test entry was performed. Complete the new-domain migration from fresh main sources so this access update is retained.
