import path from 'node:path';
import { ArenaStore } from './store.js';
import { inspectToken, makeRpc, normalizeAddress } from '../scripts/lib/token-inspection.mjs';
import { config } from '../dist/lib/config.js';
import { FIRST_ENTRY_MS } from '../dist/lib/schedule.js';

// Operator-only CLI. No public activation endpoint or signing key exists.
let store;
try {
  if (process.argv.length !== 3) throw Error('Usage: node --experimental-sqlite api/activate.js <FINAL_ARENA_CONTRACT>');
  const address = normalizeAddress(process.argv[2]);
  store = new ArenaStore(process.env.APEX_DATABASE || path.resolve('data/arena.sqlite'));
  if (store.isRetired(address, 4663)) throw Error('This token was retired and cannot be activated again. Supply a new final contract address.');
  let launch = store.launch();
  if (launch && launch.token.address !== address) throw Error('A different token is already active. Refusing to reset the live launch.');
  if (!launch) {
    const token = await inspectToken({ address, rpc: makeRpc(process.env.APEX_RPC_URL || config.network.rpcUrls[0]) });
    launch = store.activate(token, Date.now());
  }
  console.log(JSON.stringify({ token: launch.token.address, registrationOpenedAt: new Date(launch.activatedAt).toISOString(), firstRoundStartsAt: new Date(launch.activatedAt + FIRST_ENTRY_MS).toISOString(), note: 'The stored start never resets when this command is repeated or the server restarts.' }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
