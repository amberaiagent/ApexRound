# Activating the access token after launch

The owner will provide the final $APEX contract address after creating it on pons. A copied `0x` address is sufficient input; no seed, private key, token approval or transfer is needed. The example `0xec2976c9c9c5789c425584965c6780671b02792c` is **not** the configured access token.

The chain is Robinhood Chain mainnet (4663). The launchpad documents standard onchain token metadata at https://docs.ponsfamily.com/#reading-token-state. The access check uses `balanceOf(wallet)` on the exact approved contract. A matching ticker/name on another contract does not grant access. Factory provenance, if needed, should be checked against the launch page or the documented factory's launch event; merely exposing ERC-20 methods does not prove that a token was launched on pons.

## Operator flow

1. Receive the final address from the owner and verify its identity against the intended launch.
2. Run `node scripts/configure-token.mjs <address>` to inspect it without writing files. The RPC verifies the chain, deployed code, decimals, name, symbol, total supply and balance interface at one block, then checks the block hash again. Amounts use integers. Rich-text trailing whitespace is accepted; malformed/zero addresses are rejected.
3. Run `node scripts/configure-token.mjs <address> --write` to repeat those checks and atomically generate `dist/lib/access-token.js`. Contract strings are serialized as data, not executed as code. If the checks fail, the current token configuration stays unchanged.
4. Review the address in the Git diff, run `node --test tests/arena.test.js tests/wallet.test.js tests/token-configuration.test.js`, commit/push and deploy the release using the existing VPS process. Verify the public `lib/access-token.js`, the displayed explorer link and a real wallet balance. Reload the page to load the new configuration.

`APEX_RPC_URL` can supply a dedicated HTTPS RPC endpoint to the operator's process. Its value is never saved to public metadata or printed by the tool. Keep any provider API keys out of Git and shell command arguments.

`dist/lib/config.js` imports this one metadata file, so no scattered replacements, build or UI rewrite is needed. An address change must go through the owner/operator flow; the public page does not let visitors choose their own access token. The threshold remains exactly **10,000,000 tokens**, scaled by verified decimals.

## Verification performed

The owner's example was inspected read-only on 2026-09-11 local time. The RPC reported name `Æther`, symbol `Æ`, 18 decimals and total supply of 1,000,000,000 tokens. Bytecode and the balance interface passed the checks. No configuration was written and no transaction was sent. The public access-token address remains null until the owner supplies the final $APEX address.

Automated checks cover copied addresses, 6/18 decimals, wrong networks, missing code, malformed contract returns, insufficient supply, block reorganization, safe metadata serialization, RPC failures, atomic local writing and the default no-write path.

## What activation enables

The connected user can check the real token balance and see whether the balance requirement is met. Checking does not register the wallet. The competition remains in prelaunch until the authoritative registration backend, schedule and result pipeline are implemented. A future backend must use this same approved chain/address/threshold and re-read the balance through a trusted RPC when accepting registration; client-side eligibility is not an access-control boundary.
