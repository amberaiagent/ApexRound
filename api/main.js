import http from 'node:http';
import path from 'node:path';
import { ArenaStore } from './store.js';
import { ArenaService } from './service.js';
import { createApiHandler } from './http.js';
import { makeRpc } from '../scripts/lib/token-inspection.mjs';
import { config } from '../dist/lib/config.js';

const store = new ArenaStore(process.env.APEX_DATABASE || path.resolve('data/arena.sqlite'));
const service = new ArenaService(store, { rpc: makeRpc(process.env.APEX_RPC_URL || config.network.rpcUrls[0]) });
const origins = (process.env.APEX_ORIGINS || 'https://arenarounds.xyz').split(',');
const server = http.createServer(createApiHandler(service, { origins, trustProxy: process.env.APEX_TRUST_PROXY === '1' }));
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 8082), process.env.HOST || '127.0.0.1', () => console.log('APEX registration service ready; activation is controlled by the operator.'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
