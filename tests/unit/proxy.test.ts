// @vitest-environment node
import { expect, it } from 'vitest';
// @ts-expect-error Server runs natively as JavaScript.
import { createProxy } from '../../server/index.mjs';
import type { Server } from 'node:http';
it('enforces auth, schema bounds and forwards the fixed Jev endpoint', async () => {
  let forwarded = 0;
  const server: Server = createProxy({
    apiKey: 'test-server-secret',
    token: 'test-token',
    upstream: async (url: string, init: RequestInit) => {
      forwarded++;
      expect(url).toBe('https://api.typesafe.ai/v1/systemone');
      expect((init.headers as any).Authorization).toBe('Bearer test-server-secret');
      return new Response(JSON.stringify({ answers: {} }));
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/v1/evaluate`;
  try {
    expect((await fetch(url, { method: 'POST', body: '{}' })).status).toBe(401);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token', Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: 'Bearer test-token' },
          body: JSON.stringify({
            model: 'jev-latest',
            state: 'test',
            questions: {
              q: {
                type: 'score',
                instructions: 'Test',
                criteria: ['Low information', 'Essential information'],
              },
            },
          }),
        })
      ).status,
    ).toBe(200);
    expect(forwarded).toBe(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
