import type { HtmlDocumentAdapter } from '../extraction/htmlExtractor';
import type { ScoredUnit } from '../shared/types';
const COLORS: Record<string, string> = {
  critical: '#bae9a4',
  high: '#d6edb9',
  medium: '#edf4d5',
  navigator: '#bedfea',
  hover: '#ffd998',
  selected: '#ffca80',
};
export class HighlightRenderer {
  private layers = new Map<string, Range[]>();
  private host: HTMLDivElement;
  private style: HTMLStyleElement;
  constructor(private adapter: HtmlDocumentAdapter) {
    this.style = document.createElement('style');
    this.style.dataset.jevUi = 'true';
    this.style.textContent = Object.entries(COLORS)
      .map(
        ([k, v]) =>
          `::highlight(jev-${k}){background-color:${v};color:#162b22;}.textLayer::highlight(jev-${k}),.textLayer ::highlight(jev-${k}){background-color:${v}88;color:transparent;}`,
      )
      .join('');
    document.documentElement.append(this.style);
    this.host = document.createElement('div');
    this.host.dataset.jevUi = 'true';
    this.host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483645';
    document.documentElement.append(this.host);
    window.addEventListener('scroll', this.redraw, { passive: true });
    window.addEventListener('resize', this.redraw);
  }
  private set(layer: string, ranges: Range[]) {
    this.layers.set(layer, ranges);
    if (globalThis.CSS?.highlights && globalThis.Highlight)
      CSS.highlights.set(`jev-${layer}`, new Highlight(...ranges));
  }
  render(items: ScoredUnit[], navigator = false) {
    const hover = this.layers.get('hover') || [];
    const selected = this.layers.get('selected') || [];
    this.clear();
    for (const level of ['critical', 'high', 'medium', 'navigator'])
      this.set(
        level,
        items
          .filter((i) =>
            navigator
              ? level === 'navigator'
              : (i.score >= 0.85 ? 'critical' : i.score >= 0.7 ? 'high' : 'medium') === level,
          )
          .flatMap((i) => this.adapter.resolve(i.unitId)),
      );
    this.set('hover', hover);
    this.set('selected', selected);
    this.redraw();
  }
  emphasize(id: string | null, selected = false) {
    this.set(selected ? 'selected' : 'hover', id ? this.adapter.resolve(id) : []);
    this.redraw();
  }
  clear() {
    for (const key of Object.keys(COLORS)) CSS?.highlights?.delete(`jev-${key}`);
    this.layers.clear();
    this.host.replaceChildren();
  }
  private redraw = () => {
    if (globalThis.CSS?.highlights) return;
    this.host.replaceChildren();
    for (const [layer, ranges] of this.layers)
      for (const r of ranges)
        for (const rect of r.getClientRects()) {
          if (rect.bottom < 0 || rect.top > innerHeight) continue;
          const box = document.createElement('div');
          box.style.cssText = `position:absolute;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;background:${COLORS[layer]};opacity:.4;border-radius:2px`;
          this.host.append(box);
        }
  };
  destroy() {
    this.clear();
    this.host.remove();
    this.style.remove();
    window.removeEventListener('scroll', this.redraw);
    window.removeEventListener('resize', this.redraw);
  }
}
