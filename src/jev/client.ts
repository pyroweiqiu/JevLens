import { z } from 'zod';
import type {
  ActionCandidate,
  CursorDecision,
  ScoredUnit,
  Settings,
  TextUnit,
} from '../shared/types';
import { scoreRequest, actionRequest } from './prompts';
import { activeConnection, PROVIDER_LABELS, validateConnection } from '../shared/settings';
const probability = z.number().min(0).max(1);
const answer = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('score'),
    score: z.number().min(0).max(3),
    confidence: probability,
    probabilities: z.record(probability),
  }),
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    confidence: probability,
    probabilities: z.record(probability),
  }),
]);
export const responseSchema = z.object({
  answers: z.record(answer),
  usage: z
    .object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() })
    .optional(),
});
export interface BatchResult {
  scores: ScoredUnit[];
  inputTokens: number;
  outputTokens: number;
}
export interface DecisionProvider {
  score(
    units: TextUnit[],
    title: string,
    url: string,
    intent: string | undefined,
    signal: AbortSignal,
  ): Promise<BatchResult>;
  choose(
    candidates: ActionCandidate[],
    goal: string,
    history: string[],
    signal: AbortSignal,
  ): Promise<CursorDecision>;
}
export class JevDecisionProvider implements DecisionProvider {
  constructor(private settings: Settings) {}
  private async request(
    body: ReturnType<typeof scoreRequest> | ReturnType<typeof actionRequest>,
    signal: AbortSignal,
  ) {
    const error = validateConnection(this.settings);
    if (error) throw new Error(error);
    const connection = activeConnection(this.settings);
    if (!connection) throw new Error('Choose a remote API provider first.');
    const label = PROVIDER_LABELS[this.settings.provider];
    let response: Response;
    try {
      response = await fetch(connection.endpoint.trim(), {
        method: 'POST',
        signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
        credentials: 'omit',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          ...(connection.token.trim()
            ? { Authorization: `Bearer ${connection.token.trim()}` }
            : {}),
        },
        body: JSON.stringify({ ...body, model: connection.model.trim() }),
      });
    } catch (e) {
      signal.throwIfAborted();
      if (e instanceof Error && e.name === 'TimeoutError')
        throw new Error(`${label} request timed out. Try again.`);
      throw new Error(`Cannot reach ${label}. Check the endpoint and network connection.`);
    }
    if (!response.ok) {
      const hint =
        response.status === 401 || response.status === 403
          ? 'Check the API key and access permissions.'
          : response.status === 402
            ? 'Check the account balance.'
            : response.status === 429
              ? 'Rate limit reached. Please retry later.'
              : response.status === 404
                ? 'Check the endpoint and model ID.'
                : 'Check the endpoint, model and provider status.';
      throw new Error(`${label} returned ${response.status}. ${hint}`);
    }
    try {
      return responseSchema.parse(await response.json());
    } catch {
      throw new Error(
        `${label} returned an incompatible response. Use a Jev / Decisions-compatible endpoint.`,
      );
    }
  }
  async score(
    units: TextUnit[],
    title: string,
    url: string,
    intent: string | undefined,
    signal: AbortSignal,
  ): Promise<BatchResult> {
    const response = await this.request(scoreRequest(units, title, url, intent), signal);
    return {
      scores: units.map((u, i) => {
        const a = response.answers[`q${i}`];
        if (!a || a.type !== 'score') throw new Error('Jev response is missing a score.');
        return { unitId: u.unitId, score: a.score / 3, confidence: a.confidence };
      }),
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }
  async choose(
    candidates: ActionCandidate[],
    goal: string,
    history: string[],
    signal: AbortSignal,
  ) {
    if (candidates.length > 200) {
      const groups = Array.from({ length: Math.ceil(candidates.length / 200) }, (_, i) =>
        candidates.slice(i * 200, (i + 1) * 200),
      );
      const selections: CursorDecision[] = await Promise.all(
        groups.map((group) => this.choose(group, goal, history, signal)),
      );
      signal.throwIfAborted();
      const winners = candidates.filter((c) => selections.some((s) => s.id === c.id));
      const result: CursorDecision =
        winners.length > 1
          ? await this.choose(winners, goal, history, signal)
          : selections.find((s) => s.id !== 'none') || {
              id: 'none',
              confidence: 0,
              probability: 0,
            };
      return {
        ...result,
        inputTokens:
          selections.reduce((sum, s) => sum + (s.inputTokens || 0), 0) +
          (winners.length > 1 ? result.inputTokens || 0 : 0),
        outputTokens:
          selections.reduce((sum, s) => sum + (s.outputTokens || 0), 0) +
          (winners.length > 1 ? result.outputTokens || 0 : 0),
      };
    }
    if (!candidates.length)
      return { id: 'none', confidence: 0, probability: 0, inputTokens: 0, outputTokens: 0 };
    const response = await this.request(actionRequest(candidates, goal, history), signal);
    const a = response.answers.next_action;
    if (
      !a ||
      a.type !== 'choice' ||
      (a.choice !== 'none' && !candidates.some((c) => c.id === a.choice))
    )
      throw new Error('Invalid action choice.');
    return {
      id: a.choice,
      confidence: a.confidence,
      probability: a.probabilities[a.choice] || 0,
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
    };
  }
}
function words(text: string) {
  return (
    text
      .toLowerCase()
      .match(/[\p{L}\p{N}]{3,}/gu)
      ?.filter(
        (w) =>
          ![
            'the',
            'what',
            'how',
            'this',
            'that',
            'find',
            'are',
            'with',
            'and',
            'for',
            'was',
          ].includes(w),
      ) || []
  );
}
export class MockDecisionProvider implements DecisionProvider {
  async score(
    units: TextUnit[],
    _title: string,
    _url: string,
    intent: string | undefined,
    signal: AbortSignal,
  ): Promise<BatchResult> {
    signal.throwIfAborted();
    const terms = words(intent || '');
    return {
      scores: units.map((u) => {
        const text = (u.headingPath.join(' ') + ' ' + u.text).toLowerCase();
        const overlap = terms.filter((w) => text.includes(w)).length;
        const score = intent
          ? terms.length
            ? Math.min(0.98, 0.08 + (0.9 * overlap) / Math.min(terms.length, 3))
            : 0
          : Math.min(
              0.96,
              0.45 +
                (u.text.length > 70 ? 0.14 : 0) +
                (/important|must|result|train|install|conclu|warning|requires|achieve|model|核心|训练|注意|结果/i.test(
                  u.text,
                )
                  ? 0.25
                  : 0) +
                (/\d/.test(u.text) ? 0.06 : 0),
            );
        return { unitId: u.unitId, score, confidence: 0 };
      }),
      inputTokens: 0,
      outputTokens: 0,
    };
  }
  async choose(
    candidates: ActionCandidate[],
    goal: string,
    _history: string[],
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const terms = words(goal);
    const ranked = candidates
      .filter((c) => !c.riskHints.length)
      .map((c) => ({
        c,
        n: terms.filter((w) => c.accessibleName.toLowerCase().includes(w)).length,
      }))
      .sort((a, b) => b.n - a.n);
    return {
      id: ranked[0]?.n ? ranked[0].c.id : 'none',
      confidence: 0,
      probability: 0,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

/** Sends only this fixed sample, never page content, to verify the configured Score and Choice contract. */
export async function testConnection(settings: Settings, signal: AbortSignal): Promise<void> {
  const provider = new JevDecisionProvider(settings);
  const unit: TextUnit = {
    unitId: 'connection-test',
    blockId: 'sample',
    text: 'Install the package before running the application.',
    headingPath: ['Setup'],
    inViewport: true,
    locator: {
      kind: 'html-text',
      blockHash: 'sample',
      headingPath: [],
      textPrefix: 'Install',
      startOffset: 0,
      endOffset: 52,
    },
  };
  await provider.score([unit], 'Lens connection test', 'https://example.com', undefined, signal);
  await provider.choose(
    [
      {
        id: 'setup',
        role: 'link',
        accessibleName: 'Installation guide',
        riskHints: [],
        fingerprint: 'sample',
      },
    ],
    'Find installation instructions',
    [],
    signal,
  );
}
