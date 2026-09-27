import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
const question = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('score'),
      instructions: z.string().max(2000),
      criteria: z.array(z.string().max(1000)).min(2).max(10),
    })
    .strict(),
  z
    .object({
      type: z.literal('choice'),
      instructions: z.string().max(2000),
      criteria: z
        .record(z.string().max(1000))
        .refine((v) => Object.keys(v).length >= 2 && Object.keys(v).length <= 65),
    })
    .strict(),
]);
export const requestSchema = z
  .object({
    model: z.literal('jev-latest'),
    state: z.string().max(60000),
    questions: z
      .record(question)
      .refine((v) => Object.keys(v).length > 0 && Object.keys(v).length <= 24),
  })
  .strict();
export function createProxy({
  apiKey = process.env.TYPESAFE_API_KEY,
  token = process.env.LENS_PROXY_TOKEN || '',
  allowedOrigins = process.env.LENS_ALLOWED_ORIGINS?.split(',').filter(Boolean) || [],
  upstream = fetch,
} = {}) {
  const limits = new Map();
  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const originAllowed = allowedOrigins.length
      ? allowedOrigins.includes(origin)
      : /^chrome-extension:\/\/[a-p]{32}$/.test(origin) || !origin;
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!originAllowed) return send(403, { error: 'Origin is not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (req.url === '/health' && req.method === 'GET') return send(200, { ready: !!apiKey });
    if (req.url !== '/v1/evaluate' || req.method !== 'POST')
      return send(404, { error: 'Not found.' });
    if (token && req.headers.authorization !== `Bearer ${token}`)
      return send(401, { error: 'Invalid proxy token.' });
    if (!apiKey) return send(503, { error: 'TYPESAFE_API_KEY is not configured on the server.' });
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    if (limits.size > 1000)
      for (const [key, val] of limits) if (now > val.reset) limits.delete(key);
    const limit = limits.get(ip) || { count: 0, reset: now + 60000 };
    if (now > limit.reset) {
      limit.count = 0;
      limit.reset = now + 60000;
    }
    limits.set(ip, limit);
    if (++limit.count > 60) {
      res.setHeader('Retry-After', '60');
      return send(429, { error: 'Rate limit reached.' });
    }
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        chunks.push(chunk);
        size += chunk.length;
        if (size > 160000) {
          send(413, { error: 'Request too large.' });
          return;
        }
      }
      const body = Buffer.concat(chunks).toString('utf8');
      let parsed;
      try {
        parsed = requestSchema.safeParse(JSON.parse(body));
      } catch {
        return send(400, { error: 'Malformed JSON.' });
      }
      if (!parsed.success) return send(400, { error: 'Invalid or oversized inference request.' });
      const response = await upstream('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok)
        return send(response.status === 429 ? 429 : 502, {
          error: 'TypeSafe request failed.',
          status: response.status,
        });
      send(200, await response.json());
    } catch {
      if (!res.headersSent && !res.destroyed)
        send(502, { error: 'TypeSafe is unavailable or the request timed out.' });
    } finally {
      clearTimeout(timeout);
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '127.0.0.1';
  if (
    !['127.0.0.1', 'localhost'].includes(host) &&
    (!process.env.LENS_PROXY_TOKEN || !process.env.LENS_ALLOWED_ORIGINS)
  )
    throw new Error('A public bind requires LENS_PROXY_TOKEN and LENS_ALLOWED_ORIGINS.');
  createProxy().listen(Number(process.env.PORT || 8787), host, () =>
    console.log(
      `Jev proxy listening on ${host}:${process.env.PORT || 8787}; page text is never logged.`,
    ),
  );
}
