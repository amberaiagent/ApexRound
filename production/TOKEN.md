# Final-token activation

The owner supplied and authorized **0xfb57c3f37c6122817981c8ac94b24a1b844f766a**. Real RPC inspection returned **Apex / APEX**, 18 decimals and total supply of 1 billion. The example `0xec2976c9c9c5789c425584965c6780671b02792c` is **not** the configured token. Never activate it as a placeholder.

The approved network is Robinhood Chain mainnet (4663). Access is tied to the exact contract address, not its name or ticker. See https://docs.ponsfamily.com/#reading-token-state. ERC-20 compatibility alone does not prove launchpad provenance; verify the intended launch identity against the owner's final address.

## Operator flow

1. Receive the final address from the owner. Confirm remaining competition rules and result-pipeline readiness before a real competitive launch.
2. Inspect without starting anything: `node scripts/configure-token.mjs <FINAL_CA>`. The script verifies chain, bytecode, decimals, metadata, supply, balance interface and block hash.
3. On the VPS, activate using the existing container:
   `docker exec apex-api node api/activate.js <FINAL_CA>`
4. This repeats the onchain checks, writes the verified token and one activation timestamp to the persistent server database, and **immediately starts the main 30:00 timer and opens registration**. The timestamp is set after successful verification, not when inspection begins.
5. Verify `https://apex-round.com/api/arena` and the page: official CA, registration open, upcoming round #1, one main timer. Open pages refresh within 15 seconds. No rebuild or second countdown is needed.
6. At activation + 30 minutes, the first 24-hour round starts and entry closes. The main timer switches to the round countdown automatically. Every later round lasts exactly 24 hours; its entry period is the previous round's final hour.

Repeating activation with the same CA returns the original timestamp. A different CA is refused once launched. Restarting or deploying the API retains the database and timer. There is no public activation/reset endpoint. Never delete or overwrite the live database to change the schedule.

`scripts/configure-token.mjs --write` remains an optional local metadata export for inspection. It **does not activate the live token or timer**. The UI takes the authoritative token and time from `/api/arena`; editing browser files cannot reset a round.

`APEX_RPC_URL` optionally supplies a dedicated HTTPS RPC endpoint to the service/operator. Keep it in private server configuration; never commit it, print it or add it to public browser files. No wallet private key, token approval or transfer is required.

## Entry acceptance
The visitor connects their wallet, checks their balance, then separately clicks Join round. They sign a readable EIP-191 message naming the domain, wallet, chain, exact token, round and dates, with a short-lived nonce. The server verifies it and independently reads the latest balance on the approved chain. The threshold is exactly 10,000,000 tokens using verified decimals. Late/duplicate/replayed requests fail even if the browser still shows an enabled button.

## Current boundaries
The final-token activation command is authorized by the owner. Check `/api/arena` for its actual timestamp; never infer activation from this document or browser files. Trade ingestion, portfolio valuation, rankings and payouts are separate unfinished work. Activation starts the agreed schedule and registration; it does not create a result pipeline.
