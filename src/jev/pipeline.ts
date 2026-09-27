import { inferenceCacheIdentity } from '../shared/settings';
import { hash } from '../cache/contentHash';
import { getScore, putScore } from '../cache/indexedDb';
import { JevDecisionProvider, MockDecisionProvider } from './client';
import {
  PROMPT_VERSION,
  type ExtractedDocument,
  type Metric,
  type ScoredUnit,
  type Settings,
} from '../shared/types';
export function selectHighlights(
  scores: ScoredUnit[],
  density: number,
  intent = false,
): ScoredUnit[] {
  const ranked = scores
    .filter((s) => s.score >= (intent ? 0.5 : 0.55))
    .sort((a, b) => b.score - a.score);
  const max = intent ? Math.min(30, ranked.length) : Math.ceil(scores.length * density);
  const counts = new Map<string, number>();
  return ranked
    .filter((s) => {
      const block = s.unitId.slice(0, s.unitId.lastIndexOf('-'));
      const count = counts.get(block) || 0;
      counts.set(block, count + 1);
      return intent || count < 2;
    })
    .slice(0, max);
}
export async function analyze(
  doc: ExtractedDocument,
  settings: Settings,
  intent: string | undefined,
  signal: AbortSignal,
  onBatch: (scores: ScoredUnit[], metric: Metric) => void,
) {
  const provider =
    settings.provider === 'demo' ? new MockDecisionProvider() : new JevDecisionProvider(settings);
  const sorted = [...doc.units].sort((a, b) => Number(b.inViewport) - Number(a.inViewport));
  const scores: ScoredUnit[] = [];
  const batchSize = doc.granularity === 'sentence' ? 20 : 10;
  for (let i = 0; i < sorted.length; i += batchSize) {
    signal.throwIfAborted();
    const units = sorted.slice(i, i + batchSize);
    const start = performance.now();
    const keys = units.map((u) =>
      hash(
        [
          inferenceCacheIdentity(settings),
          doc.url,
          doc.title,
          doc.granularity,
          u.headingPath.join('/'),
          u.text,
          intent || 'GENERAL',
          PROMPT_VERSION,
        ].join('|'),
      ),
    );
    const cached = await Promise.all(keys.map(getScore));
    const missing = units.filter((_, j) => !cached[j]);
    const result = missing.length
      ? await provider.score(missing, doc.title, doc.url, intent, signal)
      : { scores: [], inputTokens: 0, outputTokens: 0 };
    signal.throwIfAborted();
    const byId = new Map(result.scores.map((s) => [s.unitId, s]));
    const batch = units.map((u, j) => ({
      unitId: u.unitId,
      ...(cached[j] || byId.get(u.unitId)!),
    }));
    await Promise.all(
      batch.map((s, j) =>
        cached[j]
          ? Promise.resolve()
          : putScore(keys[j], { score: s.score, confidence: s.confidence }),
      ),
    );
    signal.throwIfAborted();
    scores.push(...batch);
    onBatch([...scores], {
      mode: intent ? 'navigator' : 'highlight',
      units: units.length,
      latencyMs: Math.round(performance.now() - start),
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheHit: !missing.length,
    });
  }
  return scores;
}
