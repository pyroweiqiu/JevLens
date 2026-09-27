import { afterEach, expect, it, vi } from 'vitest';
import { JevDecisionProvider, MockDecisionProvider, responseSchema } from '../../src/jev/client';
import { scoreRequest } from '../../src/jev/prompts';
import { selectHighlights } from '../../src/jev/pipeline';
import { DEFAULT_SETTINGS, type TextUnit } from '../../src/shared/types';
import { pageCommandSchema } from '../../src/messaging/protocol';
import { testConnection } from '../../src/jev/client';
afterEach(() => vi.unstubAllGlobals());
const unit: TextUnit = {
  unitId: 's1',
  blockId: 'b1',
  text: 'Training requires eight GPUs.',
  headingPath: ['Training'],
  inViewport: true,
  locator: {
    kind: 'html-text',
    blockHash: 'h',
    headingPath: [],
    textPrefix: 'Training',
    startOffset: 0,
    endOffset: 29,
  },
};
it('puts complete unit identity in instructions, not only question keys', () => {
  const r = scoreRequest([unit], 'Title', 'https://example.com');
  expect(r.questions.q0.instructions).toContain('s1');
  expect(r.questions.q0.criteria).toHaveLength(4);
});
it('validates and normalizes the live Score contract', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        answers: {
          q0: {
            type: 'score',
            score: 2.4,
            confidence: 0.8,
            probabilities: { '2': 0.6, '3': 0.4 },
          },
        },
        usage: { input_tokens: 12, output_tokens: 8 },
      }),
    }),
  );
  const result = await new JevDecisionProvider({ ...DEFAULT_SETTINGS, provider: 'custom' }).score(
    [unit],
    'Title',
    '',
    undefined,
    new AbortController().signal,
  );
  expect(result.scores[0].score).toBeCloseTo(0.8);
  expect(result.inputTokens).toBe(12);
  vi.unstubAllGlobals();
});
it('rejects malformed scores and unapproved execution messages', () => {
  expect(
    responseSchema.safeParse({ answers: { q: { type: 'score', score: 40, confidence: 2 } } })
      .success,
  ).toBe(false);
  expect(pageCommandSchema.safeParse({ type: 'EXECUTE', id: 'a1', approved: false }).success).toBe(
    false,
  );
});
it('demo relevance has a meaningful no-match and no fabricated confidence', async () => {
  const provider = new MockDecisionProvider();
  const result = await provider.score(
    [unit],
    '',
    '',
    'refund policy',
    new AbortController().signal,
  );
  expect(result.scores[0].score).toBeLessThan(0.5);
  expect(result.scores[0].confidence).toBe(0);
});
it('honors density, minimum scores, and per-block cap', () => {
  const scores = Array.from({ length: 20 }, (_, i) => ({
    unitId: `b-${i}-0`,
    score: 0.9 - i * 0.01,
    confidence: 0.8,
  }));
  expect(selectHighlights(scores, 0.2)).toHaveLength(4);
  expect(selectHighlights([{ unitId: 'x', score: 0.1, confidence: 1 }], 1)).toEqual([]);
});

it.each([
  ['jev', 'https://api.typesafe.ai/v1/systemone', 'jev-latest'],
  ['openrouter', 'https://openrouter.ai/api/alpha/decisions', 'typesafe/jev-1.13'],
  ['custom', 'https://decisions.example/custom/path', 'custom-jev'],
] as const)(
  'routes %s Score and Choice with the selected model and its own key',
  async (source, endpoint, model) => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.provider = source;
    settings.connections[source] = { endpoint, model, token: `key-for-${source}` };
    const mock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      const request = JSON.parse(options.body as string);
      return new Response(
        JSON.stringify({
          answers: request.questions.next_action
            ? {
                next_action: {
                  type: 'choice',
                  choice: 'install',
                  confidence: 0.8,
                  probabilities: { install: 0.9, none: 0.1 },
                },
              }
            : {
                q0: {
                  type: 'score',
                  score: 2.7,
                  confidence: 0.8,
                  probabilities: { '2': 0.3, '3': 0.7 },
                },
              },
          usage: { input_tokens: 14, output_tokens: 8 },
        }),
      );
    });
    vi.stubGlobal('fetch', mock);
    const provider = new JevDecisionProvider(settings);
    expect(
      (await provider.score([unit], 'Title', '', undefined, new AbortController().signal)).scores[0]
        .score,
    ).toBeCloseTo(0.9);
    expect(
      (
        await provider.choose(
          [
            {
              id: 'install',
              accessibleName: 'Install',
              fingerprint: 'i',
              riskHints: [],
              role: 'link',
            },
          ],
          'Install',
          [],
          new AbortController().signal,
        )
      ).id,
    ).toBe('install');
    expect(mock).toHaveBeenCalledTimes(2);
    for (const [url, options] of mock.mock.calls) {
      expect(url).toBe(endpoint);
      expect(JSON.parse(options.body).model).toBe(model);
      expect(options.headers.Authorization).toBe(`Bearer key-for-${source}`);
      expect(options.redirect).toBe('error');
      expect(options.credentials).toBe('omit');
    }
  },
);
it('returns helpful errors without exposing a provider response containing a secret', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('key echoed: should-stay-private', { status: 401 })),
  );
  const promise = new JevDecisionProvider({ ...DEFAULT_SETTINGS, provider: 'custom' }).score(
    [unit],
    '',
    '',
    undefined,
    new AbortController().signal,
  );
  await expect(promise).rejects.toThrow('401. Check the API key');
});
it('checks both native decision types using only a synthetic connection sample', async () => {
  const mock = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
    const request = JSON.parse(options.body as string);
    expect(request.state).toContain('Install');
    expect(request.state).not.toContain('Private page text');
    return new Response(
      JSON.stringify({
        answers: request.questions.next_action
          ? {
              next_action: {
                type: 'choice',
                choice: 'setup',
                confidence: 1,
                probabilities: { setup: 1, none: 0 },
              },
            }
          : { q0: { type: 'score', score: 3, confidence: 1, probabilities: { '3': 1 } } },
      }),
    );
  });
  vi.stubGlobal('fetch', mock);
  await testConnection({ ...DEFAULT_SETTINGS, provider: 'custom' }, new AbortController().signal);
  expect(mock).toHaveBeenCalledTimes(2);
});
it('rejects chat completion responses at a custom endpoint', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: 'A generated answer' } }] })),
      ),
  );
  await expect(
    new JevDecisionProvider({ ...DEFAULT_SETTINGS, provider: 'custom' }).score(
      [unit],
      '',
      '',
      undefined,
      new AbortController().signal,
    ),
  ).rejects.toThrow('Jev / Decisions-compatible');
});
