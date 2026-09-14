import { ApiError, addressOf } from './service.js';

export function createApiHandler(service, { origins = ['https://arenarounds.xyz'], trustProxy = false } = {}) {
  const buckets = new Map();
  let inFlight = 0;
  function limit(key, maximum) {
    const now = Date.now();
    if (buckets.size > 2000) for (const [id, item] of buckets) if (item.until <= now) buckets.delete(id);
    let bucket = buckets.get(key);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 10000) throw new ApiError(429, 'Too many requests. Try again shortly.');
      buckets.set(key, bucket = { n: 0, until: now + 60000 });
    }
    if (++bucket.n > maximum) throw new ApiError(429, 'Too many requests. Try again shortly.');
  }
  function send(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status === 429 ? { 'Retry-After': '60' } : {}) });
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new ApiError(415, 'Use application/json.');
    if (Number(req.headers['content-length']) > 8192) throw new ApiError(413, 'Request is too large.');
    let size = 0, chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 8192) throw new ApiError(413, 'Request is too large.');
      chunks.push(chunk);
    }
    let value;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, 'Invalid request.');
    return value;
  }
  return async (req, res) => {
    let counted = false;
    try {
      const url = new URL(req.url, 'http://localhost');
      const ip = trustProxy ? String(req.headers['x-apex-client-ip'] ?? req.socket.remoteAddress) : req.socket.remoteAddress;
      limit('read:' + ip, 180);
      if (req.method === 'GET' && url.pathname === '/api/health') { send(res, 200, { ok: true }); return; }
      if (req.method === 'GET' && url.pathname === '/api/arena') {
        const address = url.searchParams.has('wallet') ? addressOf(url.searchParams.get('wallet')) : null;
        send(res, 200, service.state(address)); return;
      }
      if (req.method !== 'POST' || !['/api/entry/challenge', '/api/entry/register'].includes(url.pathname)) throw new ApiError(404, 'Not found.');
      const origin = req.headers.origin;
      if (!origins.includes(origin)) throw new ApiError(403, 'This origin is not allowed.');
      limit('write:' + ip, 30);
      if (inFlight >= 8) throw new ApiError(503, 'Registration is busy. Please try again.');
      inFlight++; counted = true;
      const input = await body(req);
      if (url.pathname.endsWith('/challenge')) {
        limit('wallet:' + addressOf(input.address), 5);
        send(res, 200, service.challenge(input, origin));
      } else {
        send(res, 201, await service.register(input, origin));
      }
    } catch (error) {
      send(res, error instanceof ApiError ? error.status : 503, { error: error instanceof ApiError ? error.message : 'The registration service could not verify this request. Please try again.' });
    } finally { if (counted) inFlight--; }
  };
}
