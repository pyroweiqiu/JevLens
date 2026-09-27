import type { Granularity } from '../shared/types';
export function segment(text: string, granularity: Granularity, locale?: string) {
  let entries: { segment: string; index: number }[];
  if (granularity === 'paragraph') entries = [{ segment: text, index: 0 }];
  else {
    try {
      entries = Array.from(
        new Intl.Segmenter(locale || undefined, { granularity: 'sentence' }).segment(text),
      );
    } catch {
      entries = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text));
    }
  }
  return entries.flatMap((s) => {
    const trimmed = s.segment.trim();
    if (!trimmed) return [];
    const start = s.index + s.segment.indexOf(trimmed);
    // Bound inference inputs while preserving exact original offsets.
    const chunks = [];
    for (let at = 0; at < trimmed.length; at += 1800)
      chunks.push({
        text: trimmed.slice(at, at + 1800),
        start: start + at,
        end: start + Math.min(at + 1800, trimmed.length),
      });
    return chunks;
  });
}
