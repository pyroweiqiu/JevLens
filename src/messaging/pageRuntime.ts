import { HtmlDocumentAdapter } from '../extraction/htmlExtractor';
import { HighlightRenderer } from '../highlight/renderer';
import { ActionController } from '../cursor/actions';
import { pageCommandSchema, type PageCommand, type PageEvent, type Reply } from './protocol';
export function createPageRuntime(
  emit: (event: PageEvent) => void,
  options: { pdf?: boolean } = {},
) {
  const adapter = new HtmlDocumentAdapter();
  const renderer = new HighlightRenderer(adapter);
  const actions = new ActionController(options.pdf);
  let documentId = '';
  let selectedIds: string[] = [];
  let active = '';
  let observer: IntersectionObserver | undefined;
  let timer: ReturnType<typeof setTimeout>;
  let scrollTimer: ReturnType<typeof setTimeout>;
  const follow = () => {
    let closest = '',
      distance = Infinity;
    for (const id of selectedIds) {
      const u = adapter.units.get(id);
      const el = u && adapter.blocks.get(u.blockId)?.element;
      if (!el?.isConnected) continue;
      const r = adapter.resolve(id)[0]?.getBoundingClientRect() || el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - innerHeight / 2);
      if (d < distance) {
        distance = d;
        closest = id;
      }
    }
    if (closest && closest !== active) {
      active = closest;
      emit({ type: 'ACTIVE', id: closest, documentId });
    }
  };
  const scroll = () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(follow, 90);
  };
  const handle = (raw: unknown): Reply<unknown> => {
    try {
      const cmd: PageCommand = pageCommandSchema.parse(raw);
      switch (cmd.type) {
        case 'EXTRACT': {
          const doc = adapter.extract(cmd.granularity);
          if (documentId !== doc.documentId) {
            renderer.clear();
            actions.stop();
            observer?.disconnect();
            active = '';
          }
          documentId = doc.documentId;
          return { ok: true, value: doc };
        }
        case 'PAINT':
          if (cmd.documentId !== documentId) throw new Error('Document changed.');
          selectedIds = cmd.items.map((i) => i.unitId);
          renderer.render(cmd.items, cmd.navigator);
          observer?.disconnect();
          observer = new IntersectionObserver(follow, { threshold: [0, 0.25, 0.5, 1] });
          for (const id of selectedIds) {
            const u = adapter.units.get(id);
            const el = u && adapter.blocks.get(u.blockId)?.element;
            if (el) observer.observe(el);
          }
          follow();
          break;
        case 'HOVER':
          renderer.emphasize(cmd.id);
          break;
        case 'SELECT':
          adapter.scrollTo(cmd.id);
          renderer.emphasize(cmd.id, true);
          break;
        case 'CLEAR':
          renderer.clear();
          selectedIds = [];
          observer?.disconnect();
          break;
        case 'ACTIONS':
          return { ok: true, value: actions.extract(cmd.goal) };
        case 'LIST_ACTIONS':
          return { ok: true, value: new ActionController(!!options.pdf).extract() };
        case 'PROPOSE':
          actions.propose(cmd.id);
          break;
        case 'EXECUTE':
          actions.execute(cmd.id, cmd.approved);
          break;
        case 'STOP':
          actions.stop();
          break;
      }
      return { ok: true, value: null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Page operation failed.',
      };
    }
  };
  const mutation = new MutationObserver((records) => {
    if (document.documentElement.dataset.jevLoading) return;
    if (
      !records.some(
        (r) =>
          (!(r.target instanceof Element ? r.target : r.target.parentElement)?.closest(
            '[data-jev-ui]',
          ) &&
            [...r.addedNodes, ...r.removedNodes].some(
              (n) => !(n instanceof Element && n.hasAttribute('data-jev-ui')),
            )) ||
          (r.type === 'characterData' && !r.target.parentElement?.closest('[data-jev-ui]')) ||
          (r.type === 'attributes' && !(r.target as Element).closest('[data-jev-ui]')),
      )
    )
      return;
    actions.stop();
    clearTimeout(timer);
    timer = setTimeout(() => emit({ type: 'PAGE_CHANGED' }), 280);
  });
  // The owned PDF viewer emits PAGE_CHANGED at explicit load milestones.
  // Observing its render DOM also queues a late duplicate after loading, cancelling new proposals.
  if (!options.pdf)
    mutation.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'href', 'class', 'style'],
    });
  let url = location.href;
  const routeTimer = setInterval(() => {
    if (url !== location.href) {
      url = location.href;
      actions.stop();
      renderer.clear();
      emit({ type: 'PAGE_CHANGED' });
    }
  }, 700);
  const escape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      actions.stop();
      emit({ type: 'ESCAPE' });
    }
  };
  window.addEventListener('scroll', scroll, { passive: true });
  window.addEventListener('keydown', escape);
  return {
    handle,
    destroy() {
      mutation.disconnect();
      observer?.disconnect();
      clearTimeout(timer);
      clearTimeout(scrollTimer);
      clearInterval(routeTimer);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('keydown', escape);
      renderer.destroy();
      actions.stop();
    },
  };
}
