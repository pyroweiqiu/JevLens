import type { ExtractedDocument, Granularity, TextUnit } from '../shared/types';
import { hash, publicUrl } from '../cache/contentHash';
import { segment } from './sentenceSegmenter';
export const EXCLUDE =
  'nav,footer,script,style,noscript,svg,input,textarea,select,option,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],[data-jev-ui], [role="navigation"], [role="banner"], [role="dialog"], [class*="cookie-banner"], [id*="cookie-banner"], [class*="advertisement"]';
const BLOCK_SELECTOR =
  'h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,caption,td,th,pre,dd,dt,[data-jev-pdf-block]';
const SELECTOR = `${BLOCK_SELECTOR},code`;
export function visible(el: Element): boolean {
  if (el.closest(EXCLUDE)) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const s = getComputedStyle(node);
    if (
      s.display === 'none' ||
      s.visibility === 'hidden' ||
      s.visibility === 'collapse' ||
      s.opacity === '0'
    )
      return false;
  }
  return (
    el.getClientRects().length > 0 ||
    (getComputedStyle(el).display === 'contents' &&
      Array.from(el.children).some((child) => child.getClientRects().length > 0))
  );
}
export interface LiveBlock {
  element: Element;
  text: string;
  slices: { node: Text; start: number; end: number }[];
}
export function readBlock(el: Element): LiveBlock {
  const slices: LiveBlock['slices'] = [];
  let text = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement && visible(node.parentElement)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    slices.push({ node, start: text.length, end: text.length + node.length });
    text += node.data;
  }
  return { element: el, text, slices };
}
export class HtmlDocumentAdapter {
  blocks = new Map<string, LiveBlock>();
  units = new Map<string, TextUnit>();
  extract(granularity: Granularity): ExtractedDocument {
    this.blocks.clear();
    this.units.clear();
    const outline: string[] = [];
    const occurrences = new Map<string, number>();
    const elements = Array.from(document.querySelectorAll(SELECTOR)).slice(0, 12000);
    for (const el of elements) {
      if (
        !visible(el) ||
        (el.closest('header') && !el.closest('article')) ||
        (el.closest('aside') && !el.closest('article'))
      )
        continue;
      if (/^H[1-6]$/.test(el.tagName)) {
        outline.length = Number(el.tagName[1]);
        outline[Number(el.tagName[1]) - 1] = el.textContent?.trim().slice(0, 160) || '';
      }
      // Inline code belongs to its paragraph/pre; nested block text has exactly one owner.
      if (el.tagName === 'CODE' && el.parentElement?.closest(BLOCK_SELECTOR)) continue;
      const nested = el.querySelector(BLOCK_SELECTOR);
      if (el.parentElement?.closest('[data-jev-pdf-block]')) continue;
      let block = readBlock(el);
      if (nested && !el.matches('[data-jev-pdf-block]')) {
        block = { ...block, text: '', slices: [] };
        const full = readBlock(el);
        for (const s of full.slices) {
          if (s.node.parentElement?.closest(BLOCK_SELECTOR) !== el) continue;
          block.slices.push({
            node: s.node,
            start: block.text.length,
            end: block.text.length + s.node.length,
          });
          block.text += s.node.data;
        }
      }
      if (block.text.trim().length < 20 && !/^H/.test(el.tagName)) continue;
      const path = outline.filter(Boolean);
      const blockHash = hash(path.join('/') + block.text);
      const occurrence = occurrences.get(blockHash) || 0;
      occurrences.set(blockHash, occurrence + 1);
      const blockId = `b-${blockHash}-${occurrence}`;
      this.blocks.set(blockId, block);
      const rect =
        getComputedStyle(el).display === 'contents'
          ? el.firstElementChild?.getBoundingClientRect() || el.getBoundingClientRect()
          : el.getBoundingClientRect();
      const page =
        Number(el.closest('[data-page-number]')?.getAttribute('data-page-number')) || undefined;
      for (const part of segment(block.text, granularity, document.documentElement.lang)) {
        const unit: TextUnit = {
          unitId: `${blockId}-${part.start}`,
          blockId,
          text: part.text,
          headingPath: page ? [`Page ${page}`] : path,
          inViewport: rect.bottom >= -innerHeight && rect.top <= innerHeight * 3,
          locator: {
            kind: page ? 'pdf-text' : 'html-text',
            blockHash,
            headingPath: path,
            textPrefix: part.text.slice(0, 100),
            startOffset: part.start,
            endOffset: part.end,
            page,
          },
        };
        this.units.set(unit.unitId, unit);
        if (this.units.size >= 2400) break;
      }
      if (this.units.size >= 2400) break;
    }
    const units = Array.from(this.units.values());
    const url = publicUrl(document.documentElement.dataset.sourceUrl || location.href);
    return {
      documentId: hash(location.href + granularity + units.map((u) => u.unitId).join('|')),
      url,
      title: document.title,
      units,
      granularity,
      sensitive:
        /(^|\.)(mail\.google|outlook|proton|docs\.google|notion|figma)\./i.test(
          location.hostname,
        ) ||
        /bank|health|medical|intranet/i.test(location.hostname) ||
        location.protocol === 'file:' ||
        !!document.documentElement.dataset.sourceUrl?.startsWith('file:'),
      limited:
        units.length >= 2400
          ? 'Large page: analyzing the first 2,400 text units.'
          : !units.length
            ? document.querySelector('canvas')
              ? 'Canvas content is not readable. Try a document or article.'
              : 'No readable text found. Forms and drafts are excluded.'
            : undefined,
    };
  }
  resolve(id: string): Range[] {
    const unit = this.units.get(id);
    const block = unit && this.blocks.get(unit.blockId);
    if (!unit || !block || !block.element.isConnected) return [];
    const ranges: Range[] = [];
    for (const s of block.slices) {
      const start = Math.max(unit.locator.startOffset, s.start),
        end = Math.min(unit.locator.endOffset, s.end);
      if (start >= end || !s.node.isConnected || s.node.data !== block.text.slice(s.start, s.end))
        continue;
      const r = document.createRange();
      r.setStart(s.node, start - s.start);
      r.setEnd(s.node, end - s.start);
      ranges.push(r);
    }
    return ranges.map((r) => r.toString()).join('') === unit.text ? ranges : [];
  }
  scrollTo(id: string) {
    const range = this.resolve(id)[0];
    if (!range) return;
    const rect = range.getBoundingClientRect();
    window.scrollBy({ top: rect.top - innerHeight / 2, behavior: 'smooth' });
  }
}
