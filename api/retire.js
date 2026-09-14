import path from 'node:path';
import { existsSync } from 'node:fs';
import { ArenaStore } from './store.js';
import { normalizeAddress } from '../scripts/lib/token-inspection.mjs';

// Operator-only CLI: no HTTP route, RPC call, wallet signature or transfer.
let store;
try {
  if (process.argv.length !== 3) throw Error('Usage: node --experimental-sqlite api/retire.js <EXPECTED_ACTIVE_CA>');
  const address = normalizeAddress(process.argv[2]);
  const filename = process.env.APEX_DATABASE || path.resolve('data/arena.sqlite');
  if (!existsSync(filename)) throw Error('The arena database does not exist. Check APEX_DATABASE; no database was created.');
  store = new ArenaStore(filename);
  console.log(JSON.stringify(store.retire(address), null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { store?.close(); }
