import { beforeEach, expect, it, vi } from 'vitest';
import { analyze } from '../../src/jev/pipeline';
import { MockDecisionProvider } from '../../src/jev/client';
import { DEFAULT_SETTINGS, type ExtractedDocument, type TextUnit } from '../../src/shared/types';
const cache = vi.hoisted(() => new Map());
vi.mock('../../src/cache/indexedDb', () => ({
  getScore: async (key: string) => cache.get(key),
  putScore: async (key: string, value: unknown) => {
    cache.set(key, value);
  },
}));
const unit = (i: number): TextUnit => ({
  unitId: `s${i}`,
  blockId: `b${i}`,
  text: `Important training result number ${i}.`,
  headingPath: ['Training'],
  inViewport: i === 44,
  locator: {
    kind: 'html-text',
    blockHash: `h${i}`,
    headingPath: [],
    textPrefix: '',
    startOffset: 0,
    endOffset: 30,
  },
});
const doc: ExtractedDocument = {
  documentId: 'doc',
  url: 'https://example.com/article',
  title: 'Results',
  granularity: 'sentence',
  units: Array.from({ length: 45 }, (_, i) => unit(i)),
  sensitive: false,
};
beforeEach(() => cache.clear());
it('scores viewport units first and reuses all unchanged units on revisit', async () => {
  const spy = vi.spyOn(MockDecisionProvider.prototype, 'score');
  const metrics: boolean[] = [];
  await analyze(doc, DEFAULT_SETTINGS, undefined, new AbortController().signal, (_, metric) =>
    metrics.push(metric.cacheHit),
  );
  expect(spy).toHaveBeenCalledTimes(3);
  expect(spy.mock.calls[0][0][0].unitId).toBe('s44');
  expect(metrics).toEqual([false, false, false]);
  spy.mockClear();
  await analyze(doc, DEFAULT_SETTINGS, undefined, new AbortController().signal, () => {});
  expect(spy).not.toHaveBeenCalled();
  expect(JSON.stringify([...cache.values()])).not.toContain('Important training');
});
it('only rescores changed content, and uses a separate key for new intent', async () => {
  await analyze(doc, DEFAULT_SETTINGS, undefined, new AbortController().signal, () => {});
  const spy = vi.spyOn(MockDecisionProvider.prototype, 'score');
  const changed = {
    ...doc,
    units: doc.units.map((u, i) =>
      i === 0 ? { ...u, text: 'A materially changed training result.' } : u,
    ),
  };
  await analyze(changed, DEFAULT_SETTINGS, undefined, new AbortController().signal, () => {});
  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy.mock.calls[0][0]).toHaveLength(1);
  spy.mockClear();
  await analyze(changed, DEFAULT_SETTINGS, 'training', new AbortController().signal, () => {});
  expect(spy).toHaveBeenCalledTimes(3);
});
it('does not schedule additional batches after cancellation', async () => {
  const abort = new AbortController();
  const spy = vi.spyOn(MockDecisionProvider.prototype, 'score');
  await expect(
    analyze(doc, DEFAULT_SETTINGS, undefined, abort.signal, () => abort.abort()),
  ).rejects.toThrow();
  expect(spy).toHaveBeenCalledTimes(1);
});
