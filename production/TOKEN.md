# Final-token activation

The owner requested retirement of the previous token and will supply a new final CA separately. Do not reuse a historical CA or activate an example as a placeholder. The actual active state comes only from `/api/arena`; this document does not activate or retire anything.

The approved network is Robinhood Chain mainnet (4663). Access is tied to the exact contract address, not its name or ticker. See https://docs.ponsfamily.com/#reading-token-state. ERC-20 compatibility alone does not prove launchpad provenance; verify the intended launch identity against the owner's final address.

## Operator flow

1. Receive the final address from the owner. Confirm remaining competition rules and result-pipeline readiness before a real competitive launch.
2. Inspect without starting anything: `node scripts/configure-token.mjs <FINAL_CA>`. The script verifies chain, bytecode, decimals, metadata, supply, balance interface and block hash.
3. On the VPS, activate using the existing container:
   `docker exec apex-api node api/activate.js <FINAL_CA>`
4. This repeats the onchain checks, writes the verified token and one activation timestamp to the persistent server database, and **immediately starts the main 30:00 timer and opens registration**. The timestamp is set after successful verification, not when inspection begins.
5. Verify `https://arenarounds.xyz/api/arena` and the page: official CA, registration open, upcoming round #1, one main timer. Open pages refresh within 15 seconds. No rebuild or second countdown is needed.
6. At activation + 30 minutes, the first 24-hour round starts and entry closes. The main timer switches to the round countdown automatically. Every later round lasts exactly 24 hours; its entry period is the previous round's final hour.

Repeating activation with the same active CA returns the original timestamp. A different CA is refused while a launch is active. After explicit retirement, a new verified CA starts a separate launch with its own 30-minute registration and empty active entry tables. Any CA archived as retired on this chain is permanently rejected by the activation flow. Restarting or deploying the API retains the database and timer. There is no public activation/reset endpoint. Never delete or overwrite the live database to change the schedule.

## Retire the previous token

This is an operator-only action, separate from deployment. Deploying code only creates the archive tables; it does not retire a launch. Obtain the expected CA from the owner's explicit retirement request and compare it with the live API state before running the command.

1. Deploy the API version containing `api/retire.js` and the retired-token activation guard. Keep the existing persistent database volume. Record the current API response and take a private, consistent SQLite backup using the online backup API; do not copy only the main file while WAL is active.
2. Run exactly once against the existing API database:
   `docker exec apex-api node api/retire.js <EXPECTED_ACTIVE_CA>`
   Outside Docker, use `APEX_DATABASE=/absolute/path/arena.sqlite node --experimental-sqlite api/retire.js <EXPECTED_ACTIVE_CA>`. The database must already exist. The argument is one exact nonzero contract address; it is never inferred from a ticker or URL.
3. The command checks the active CA under a SQLite write transaction, copies the original launch JSON and timestamp into `retired_launches`, and copies every remaining entry and challenge byte-for-byte into `retired_entries` and `retired_challenges`, linked by `archive_id`. Only after those copies succeed does it clear the active `launch`, `entries` and `challenges` tables. The database and all archive tables remain in place. Any failure rolls the entire transaction back.
4. The JSON result reports `archiveId`, `token`, `activatedAt`, `retiredAt`, `entriesArchived`, `challengesArchived` and `alreadyRetired`. Save it privately with the backup. Repeating the same command while no launch is active returns the same archive with `alreadyRetired: true`; it does not duplicate or erase data. A mismatched active CA fails without changing the launch, including an old retirement command run after a new token is active.
5. Verify `/api/arena`: `phase: "prelaunch"`, `token: null`, `activatedAt: null`, both participant counts zero and no personal entries. Verify the archive counts against the command result. Old nonces are absent from the active table, and already-running balance checks cannot register into a later launch, even when it reuses round #1.

Retirement performs no RPC call, signing, approval or transfer. There is no public retirement endpoint. Old signed messages and participant records remain private in the archive; they are not transferred to the new token. A later explicit final CA uses the normal activation flow above and starts the main timer at 30:00 after onchain verification succeeds.

Rollback after retirement must retain the retired database and its archives. A frontend rollback cannot restore the previous competition. Restoring the pre-retirement backup, copying archive rows back into active tables, or using an old activation CLI without the retirement guard would undo the owner's retirement decision and may lose newer data; none of those actions belongs to an ordinary deployment rollback. Keep an API release with the retirement guard when rolling back application code. The private pre-retirement backup is for separately reviewed disaster recovery, not automatic relaunch.

`scripts/configure-token.mjs --write` remains an optional local metadata export for inspection. It **does not activate the live token or timer**. The UI takes the authoritative token and time from `/api/arena`; editing browser files cannot reset a round.

`APEX_RPC_URL` optionally supplies a dedicated HTTPS RPC endpoint to the service/operator. Keep it in private server configuration; never commit it, print it or add it to public browser files. No wallet private key, token approval or transfer is required.

## Entry acceptance
The visitor connects their wallet, checks their balance, then separately clicks Join round. They sign a readable EIP-191 message naming the domain, wallet, chain, exact token, round and dates, with a short-lived nonce. The server verifies it and independently reads the latest balance on the approved chain. The threshold is exactly 5,000,000 tokens using verified decimals. Late/duplicate/replayed requests fail even if the browser still shows an enabled button.

New challenges use message version 3 and state the 5,000,000-token requirement. Historical versions 1 and 2 preserve their original 10,000,000-token text and signed bytes; any unexpired older challenge is still checked against its own signed threshold. `dist/lib/access-policy.js` defines the immutable versioned requirements shared by the browser, server and token inspection.

## Current boundaries
The replacement-token activation requires the owner's later explicit final CA. Check `/api/arena` for its actual timestamp; never infer activation from this document or browser files. Trade ingestion, portfolio valuation, rankings and payouts are separate unfinished work. Activation starts the agreed schedule and registration; it does not create a result pipeline.
