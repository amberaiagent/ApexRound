import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ArenaStore } from './api/store.js';
import { ArenaService } from './api/service.js';
import { createApiHandler } from './api/http.js';
import { makeRpc } from './scripts/lib/token-inspection.mjs';
import { config } from './dist/lib/config.js';

const root = path.resolve('dist'), port = Number(process.env.PORT || 4173);
const store = new ArenaStore(process.env.APEX_DATABASE || path.resolve('data/arena.sqlite'));
const service = new ArenaService(store, {rpc:makeRpc(process.env.APEX_RPC_URL || config.network.rpcUrls[0])});
const handler = createApiHandler(service, {origins:['http://127.0.0.1:' + port,'http://localhost:' + port]});
const server = http.createServer((req,res) => {
  if (req.url.startsWith('/api/')) { handler(req,res); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400); res.end(); return; }
  if (pathname.includes('\0')) { res.writeHead(400); res.end(); return; }
  let file = path.resolve(root,'.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
  try {
    if (fs.statSync(file).isDirectory()) {
      if (!pathname.endsWith('/')) {
        const target = new URL(req.url, 'http://localhost');
        res.writeHead(301, {Location:target.pathname + '/' + target.search}); res.end(); return;
      }
      file = path.join(file, 'index.html');
    }
  } catch { /* readFile below supplies the normal 404. */ }
  fs.readFile(file,(error,data) => {
    res.writeHead(error ? 404 : 200, {'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(error ? 'Not found' : data);
  });
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(port,'127.0.0.1',() => console.log('Local: http://127.0.0.1:' + port));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,() => server.close(() => { store.close(); process.exit(0); }));
