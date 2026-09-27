import {
  htmlSections,
  htmlSectionQuery,
  matchHtmlSections,
  sectionFingerprint,
  navigable,
} from './htmlNavigation';
import { matchingSections, sectionQuery, textSections, type PdfSection } from './pdfNavigation';
import { hash } from '../cache/contentHash';
import type { ActionCandidate } from '../shared/types';
const DANGER =
  /pay|purchase|checkout|buy|delete|remove|destroy|publish|post\b|send|submit|sign.?in|log.?in|log.?out|sign.?out|authorize|oauth|password|credential|account|security|unsubscribe|订购|支付|购买|删除|发送|发布|授权|登录|退出|密码/i;
export function safetyGate(el: Element, name: string): string[] {
  const risks: string[] = [];
  const href = el.getAttribute('href') || '';
  if (DANGER.test(name + ' ' + href))
    risks.push('Sensitive action: perform it manually on the page.');
  if (
    el.closest('form') ||
    el.hasAttribute('form') ||
    (el.matches(
      'input,textarea,select,[contenteditable],button:not([type="button"]):not([type="reset"])',
    ) &&
      el.closest('form'))
  )
    risks.push('Form interaction requires manual control.');
  if (el.matches('input,textarea,select,[contenteditable],[type="submit"],[type="reset"]'))
    risks.push('Input and submission are outside this Cursor prototype.');
  if (el.hasAttribute('download') || /\.(exe|dmg|pkg|msi|sh|zip)(?:[?#]|$)/i.test(href))
    risks.push('Downloads require manual control.');
  if (href) {
    try {
      if (!['http:', 'https:'].includes(new URL(href, location.href).protocol))
        risks.push('Unsupported link protocol.');
    } catch {
      risks.push('Invalid link.');
    }
  }
  return risks;
}
function visibleLabelText(el: Element | null): string {
  if (!el) return '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (
        node.parentElement?.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[hidden],[aria-hidden="true"],script,style',
        )
      )
        return NodeFilter.FILTER_REJECT;
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0')
          return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let text = '';
  while (walker.nextNode()) text += walker.currentNode.textContent;
  return text;
}
function nameOf(el: Element): string {
  const labelled = el
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => visibleLabelText(document.getElementById(id)))
    .join(' ');
  return (
    el.getAttribute('aria-label') ||
    labelled ||
    visibleLabelText(el) ||
    el.getAttribute('title') ||
    el.getAttribute('placeholder') ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}
export class ActionController {
  private targets = new Map<
    string,
    {
      el: HTMLElement;
      candidate: ActionCandidate;
      page?: number;
      section?: boolean;
      scroll?: string;
    }
  >();
  private proposed: string | null = null;
  private halo?: HTMLDivElement;
  constructor(private readonly pdf = false) {}
  extract(goal = ''): ActionCandidate[] {
    this.stop();
    this.targets.clear();
    if (/^scroll (?:to top|to bottom|up|down)$/i.test(goal)) {
      const candidate: ActionCandidate = {
        id: goal,
        role: 'page-scroll',
        accessibleName: goal,
        fingerprint: goal,
        riskHints: [],
      };
      this.targets.set(goal, { el: document.documentElement, candidate, scroll: goal });
      return [candidate];
    }
    if (this.pdf) {
      if (!goal) {
        for (const el of document.querySelectorAll<HTMLElement>('.pdf-page[data-page-number]')) {
          const page = Number(el.dataset.pageNumber);
          let sections: PdfSection[] = [];
          try {
            sections = JSON.parse(el.dataset.pdfSections || '[]');
          } catch {
            /* Ignore damaged outline. */
          }
          for (const s of sections) {
            const id = `pdf-outline-${page}-${this.targets.size}`;
            const candidate: ActionCandidate = {
              id,
              role: 'pdf-section',
              accessibleName: `Go to ${s.title} · page ${page}`,
              navigationGoal: `go to page ${page}`,
              fingerprint: id,
              riskHints: [],
            };
            this.targets.set(id, { el, page, candidate });
          }
        }
        return Array.from(this.targets.values(), (t) => t.candidate).slice(0, 300);
      }
      const match =
        goal.trim().match(/^(?:go\s+to\s+|jump\s+to\s+|open\s+)?page\s+(\d+)[.!?]?$/i) ||
        goal.trim().match(/^(?:跳转到|跳到|转到|打开|去)?第?\s*(\d+)\s*页[。！]?$/);
      if (!match) {
        const query = sectionQuery(goal);
        if (!query) return [];
        const pages = Array.from(
          document.querySelectorAll<HTMLElement>('.pdf-page[data-page-number]'),
        );
        const outlined = pages.flatMap((el) => {
          try {
            return (JSON.parse(el.dataset.pdfSections || '[]') as PdfSection[]).map((s) => ({
              ...s,
              el,
            }));
          } catch {
            return [];
          }
        });
        const fromOutline = matchingSections(outlined, query);
        const matches = fromOutline.length ? fromOutline : matchingSections(textSections(), query);
        if (!matches.length)
          throw new Error(
            `No PDF section matching “${query}” was found in the loaded bookmarks or text headings. Wait for loading to finish, try the exact heading, or use Find to locate its text.`,
          );
        return matches.map((section, index) => {
          const id = `pdf-section-${section.page}-${hash(section.title)}-${index}`;
          const candidate: ActionCandidate = {
            id,
            role: 'pdf-section',
            accessibleName: `Go to ${section.title} · page ${section.page}`,
            fingerprint: id,
            riskHints: [],
          };
          this.targets.set(id, { el: section.el, page: section.page, candidate });
          return candidate;
        });
      }
      const page = Number(match[1]);
      const pages = document.querySelectorAll<HTMLElement>('.pdf-page[data-page-number]');
      const el = Array.from(pages).find((el) => Number(el.dataset.pageNumber) === page);
      if (!el)
        throw new Error(
          `PDF page ${page} is unavailable. ${pages.length} pages are loaded; choose a loaded page or wait for the PDF to finish loading.`,
        );
      const candidate: ActionCandidate = {
        id: `pdf-page-${page}`,
        role: 'pdf-page',
        accessibleName: `Go to page ${page}`,
        fingerprint: `pdf-page-${page}`,
        riskHints: [],
      };
      this.targets.set(candidate.id, { el, candidate, page });
      return [candidate];
    }
    const sectionGoal = htmlSectionQuery(goal);
    if (!goal || sectionGoal) {
      const sections = htmlSections();
      const qualified = sectionGoal?.match(/^(.*?) · match (\d+)$/i);
      const matches = sectionGoal
        ? matchHtmlSections(sections, qualified?.[1] || sectionGoal)
        : sections;
      const requestedMatch = qualified ? Number(qualified[2]) : undefined;
      if (requestedMatch !== undefined && (!requestedMatch || requestedMatch > matches.length))
        throw new Error(
          'That numbered section is no longer available. Select it again from the current page outline.',
        );
      if (sectionGoal && !matches.length)
        throw new Error(
          `No section matching “${sectionGoal}” in the loaded page. Try a heading or table-of-contents label shown below. Use Find for text, or Open + a link label to open another page.`,
        );
      for (const [index, section] of matches.entries()) {
        if (requestedMatch !== undefined && index + 1 !== requestedMatch) continue;
        const id = `html-section-${index}-${section.fingerprint}`;
        const duplicate =
          matches.filter((other) => other.title === section.title && other.el !== section.el)
            .length > 0;
        const navigationGoal = `go to ${section.title}${duplicate ? ` · match ${matches.slice(0, index + 1).filter((other) => other.title === section.title).length}` : ''}`;
        const candidate: ActionCandidate = {
          id,
          role: 'html-section',
          navigationGoal,
          accessibleName: navigationGoal.replace(/^go to /, 'Go to '),
          fingerprint: section.fingerprint,
          riskHints: [],
        };
        this.targets.set(id, { el: section.el, candidate, section: true });
      }
      if (sectionGoal) return Array.from(this.targets.values(), (t) => t.candidate);
    }
    let controlCount = 0;
    for (const el of document.querySelectorAll<HTMLElement>(
      'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="tab"],[role="menuitem"]',
    )) {
      if (
        el.closest('[data-jev-ui],[hidden],[aria-hidden="true"],[inert]') ||
        el.matches(':disabled,[aria-disabled="true"]')
      )
        continue;
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      let hidden = false;
      for (let n: Element | null = el; n; n = n.parentElement) {
        const s = getComputedStyle(n);
        if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') hidden = true;
      }
      if (hidden) continue;
      const name = nameOf(el);
      if (!name) continue;
      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const href = el instanceof HTMLAnchorElement ? el.href : undefined;
      const fingerprint = hash(role + name + href);
      const id = `a-${this.targets.size}-${fingerprint}`;
      const candidate: ActionCandidate = {
        id,
        role,
        accessibleName: name,
        href: href ? new URL(href).origin + new URL(href).pathname : undefined,
        riskHints: safetyGate(el, name),
        fingerprint,
      };
      this.targets.set(id, { el, candidate });
      if (++controlCount >= 200) break;
    }
    return Array.from(this.targets.values(), (t) => t.candidate);
  }
  propose(id: string) {
    this.stop();
    const target = this.targets.get(id);
    if (!target?.el.isConnected) throw new Error('Target changed. Find the next action again.');
    this.proposed = id;
    if (target.page || target.section || target.scroll) return;
    target.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    this.halo = document.createElement('div');
    this.halo.dataset.jevUi = 'true';
    this.halo.style.cssText =
      'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #4a8976;border-radius:8px;box-shadow:0 0 0 5px #a4dfc455;background:#a4dfc422';
    document.documentElement.append(this.halo);
    this.updateHalo();
    window.addEventListener('scroll', this.updateHalo, { passive: true });
    window.addEventListener('resize', this.updateHalo);
  }
  private updateHalo = () => {
    const el = this.proposed && this.targets.get(this.proposed)?.el;
    if (!el || !this.halo) return;
    const r = el.getBoundingClientRect();
    Object.assign(this.halo.style, {
      left: `${r.left - 4}px`,
      top: `${r.top - 4}px`,
      width: `${r.width + 8}px`,
      height: `${r.height + 8}px`,
    });
  };
  execute(id: string, approved: boolean) {
    const target = this.targets.get(id);
    if (!approved || this.proposed !== id || !target?.el.isConnected)
      throw new Error('A fresh, highlighted proposal and explicit approval are required.');
    const { el, candidate } = target;
    if (target.scroll) {
      this.stop();
      const root = document.scrollingElement || document.documentElement;
      const top =
        target.scroll === 'scroll to top'
          ? 0
          : target.scroll === 'scroll to bottom'
            ? root.scrollHeight
            : root.scrollTop + (target.scroll === 'scroll up' ? -1 : 1) * innerHeight * 0.8;
      root.scrollTo({ top, behavior: 'instant' });
      return;
    }
    if (target.section) {
      if (!navigable(el) || sectionFingerprint(el) !== candidate.fingerprint)
        throw new Error('Section changed or is hidden. Propose again.');
      this.stop();
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      return;
    }
    if (target.page) {
      if (Number(el.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber) !== target.page)
        throw new Error('PDF changed. Propose again.');
      this.stop();
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      return;
    }
    const href = el instanceof HTMLAnchorElement ? el.href : undefined;
    if (
      hash((el.getAttribute('role') || el.tagName.toLowerCase()) + nameOf(el) + href) !==
      candidate.fingerprint
    )
      throw new Error('Target changed since the proposal.');
    const risks = safetyGate(el, nameOf(el));
    if (risks.length) throw new Error(risks[0]);
    const rect = el.getBoundingClientRect();
    const point = document.elementFromPoint(
      Math.max(0, rect.left + rect.width / 2),
      Math.max(0, rect.top + rect.height / 2),
    );
    if (
      !rect.width ||
      !rect.height ||
      el.matches(':disabled,[aria-disabled="true"]') ||
      !point ||
      !(el === point || el.contains(point))
    )
      throw new Error('Target is hidden, disabled, or covered. Propose again.');
    this.stop();
    el.click();
  }
  stop() {
    this.proposed = null;
    this.halo?.remove();
    this.halo = undefined;
    window.removeEventListener('scroll', this.updateHalo);
    window.removeEventListener('resize', this.updateHalo);
  }
}
