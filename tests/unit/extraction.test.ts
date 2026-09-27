import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HtmlDocumentAdapter } from '../../src/extraction/htmlExtractor';
import { segment } from '../../src/extraction/sentenceSegmenter';
import { ActionController, safetyGate } from '../../src/cursor/actions';
const fixture = readFileSync('tests/fixtures/article.html', 'utf8');
beforeEach(() => {
  document.documentElement.innerHTML = fixture;
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    { width: 500, height: 60 },
  ] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    top: 20,
    bottom: 80,
    left: 20,
    right: 520,
    width: 500,
    height: 60,
    x: 20,
    y: 20,
    toJSON() {},
  });
});
describe('privacy and exact locators', () => {
  it('omits navigation, forms, drafts and hidden content', () => {
    const doc = new HtmlDocumentAdapter().extract('sentence');
    const text = doc.units.map((u) => u.text).join(' ');
    expect(text).not.toMatch(
      /secret-password|Private draft|Secret editable|Hidden private|Footer links|Navigation should/,
    );
    expect(text).toContain('trained with human feedback');
  });
  it('maps a sentence across inline tags exactly', () => {
    const adapter = new HtmlDocumentAdapter();
    const doc = adapter.extract('sentence');
    const unit = doc.units.find((u) => u.text.includes('trained with human'))!;
    const ranges = adapter.resolve(unit.unitId);
    expect(ranges.length).toBe(3);
    expect(ranges.map((r) => r.toString()).join('')).toBe(unit.text);
    expect(unit.headingPath.at(-1)).toBe('Training a useful model');
  });
  it('refuses stale ranges after a node changes', () => {
    const adapter = new HtmlDocumentAdapter();
    const doc = adapter.extract('sentence');
    const unit = doc.units.find((u) => u.text.includes('trained with human'))!;
    document.querySelector('#inline strong')!.textContent = 'changed text';
    expect(adapter.resolve(unit.unitId)).toEqual([]);
  });
  it('uses stable identifiers and fewer paragraph units', () => {
    const adapter = new HtmlDocumentAdapter();
    const first = adapter.extract('sentence');
    expect(adapter.extract('sentence').documentId).toBe(first.documentId);
    expect(adapter.extract('paragraph').units.length).toBeLessThan(first.units.length);
  });
  it('does not duplicate code inside pre or nested lists', () => {
    document.body.innerHTML =
      '<ul><li><p>A sufficiently long list paragraph.</p></li></ul><pre><code>npm install important-package</code></pre>';
    const doc = new HtmlDocumentAdapter().extract('paragraph');
    expect(doc.units.filter((u) => u.text.includes('list paragraph'))).toHaveLength(1);
    expect(doc.units.filter((u) => u.text.includes('npm install'))).toHaveLength(1);
  });
  it('keeps offsets exact for Chinese and whitespace', () => {
    const text = '  第一段介绍模型训练。第二段解释实验结果。 ';
    const parts = segment(text, 'sentence', 'zh');
    expect(parts).toHaveLength(2);
    for (const p of parts) expect(text.slice(p.start, p.end)).toBe(p.text);
  });
});
describe('cursor safety', () => {
  it('blocks sensitive actions and submissions', () => {
    expect(safetyGate(document.querySelector('#danger')!, 'Delete account').length).toBeGreaterThan(
      0,
    );
    expect(safetyGate(document.querySelector('form button')!, 'Continue').length).toBeGreaterThan(
      0,
    );
    expect(safetyGate(document.querySelector('#safe')!, 'Open installation guide')).toEqual([]);
  });
  it('requires a proposal and rejects changed targets', () => {
    const controller = new ActionController();
    const candidates = controller.extract();
    const safe = candidates.find((c) => c.accessibleName === 'Open installation guide')!;
    expect(() => controller.execute(safe.id, true)).toThrow(/fresh/);
    controller.propose(safe.id);
    document.querySelector('#safe')!.textContent = 'Pay now';
    expect(() => controller.execute(safe.id, true)).toThrow(/changed/);
    controller.stop();
  });
  it('does not include input values in candidates', () => {
    const serialized = JSON.stringify(new ActionController().extract());
    expect(serialized).not.toContain('secret-password');
    expect(serialized).not.toContain('Private draft');
  });
});

it('keeps short inline code in the original sentence and exact range', () => {
  document.body.innerHTML =
    '<p>You must run <code>npm install</code> before starting the development server.</p>';
  const adapter = new HtmlDocumentAdapter();
  const doc = adapter.extract('sentence');
  expect(doc.units).toHaveLength(1);
  expect(doc.units[0].text).toBe(
    'You must run npm install before starting the development server.',
  );
  expect(
    adapter
      .resolve(doc.units[0].unitId)
      .map((r) => r.toString())
      .join(''),
  ).toBe(doc.units[0].text);
});

it('excludes hidden child text and embedded drafts from action names', () => {
  document.body.innerHTML =
    '<button type="button">Open guide<span hidden>Hidden secret</span><textarea>Draft secret</textarea></button>';
  const candidates = new ActionController().extract();
  expect(candidates[0].accessibleName).toBe('Open guide');
  expect(JSON.stringify(candidates)).not.toContain('secret');
});

describe('PDF navigation', () => {
  it('requires approval and accepts English and Chinese page commands only in the PDF viewer', () => {
    document.body.innerHTML =
      '<section class="pdf-page" data-page-number="1"></section><section class="pdf-page" data-page-number="10"></section>';
    const controller = new ActionController(true);
    for (const goal of ['go to page 10', '跳到第10页']) {
      const [candidate] = controller.extract(goal);
      expect(candidate.role).toBe('pdf-page');
      expect(() => controller.execute(candidate.id, true)).toThrow(/fresh/);
      controller.propose(candidate.id);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
      controller.execute(candidate.id, true);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
      vi.mocked(Element.prototype.scrollIntoView).mockClear();
    }
    expect(() => new ActionController().extract('go to page 10')).toThrow(/No section/);
    expect(controller.extract('delete page 10')).toEqual([]);
    expect(() => controller.extract('go to page 999')).toThrow(/unavailable/);
    expect(() => controller.extract('page 0')).toThrow(/unavailable/);
  });
  it('rejects a page removed after proposal', () => {
    document.body.innerHTML = '<section class="pdf-page" data-page-number="1"></section>';
    const controller = new ActionController(true);
    const [candidate] = controller.extract('page 1');
    controller.propose(candidate.id);
    document.body.replaceChildren();
    expect(() => controller.execute(candidate.id, true)).toThrow(/fresh/);
  });
});
