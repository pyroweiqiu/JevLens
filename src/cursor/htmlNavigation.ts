import { hash } from '../cache/contentHash';
export interface HtmlSection {
  title: string;
  el: HTMLElement;
  fingerprint: string;
}
const excluded =
  '[hidden],[aria-hidden="true"],[inert],[data-jev-ui],input,textarea,select,[contenteditable]:not([contenteditable="false"]),script,style,form';
export function navigable(el: Element): boolean {
  if (el.closest(excluded)) return false;
  for (let node: Element | null = el; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === 'none' ||
      ['hidden', 'collapse'].includes(style.visibility) ||
      style.opacity === '0'
    )
      return false;
  }
  return el.getClientRects().length > 0;
}
function titleOf(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let text = '';
  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (parent && navigable(parent)) text += walker.currentNode.textContent;
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 180);
}
export function sectionFingerprint(el: HTMLElement): string {
  const path: number[] = [];
  for (let node: Element | null = el; node?.parentElement; node = node.parentElement)
    path.push(Array.from(node.parentElement.children).indexOf(node));
  return hash(el.tagName + '\n' + el.id + '\n' + path.join('.') + '\n' + titleOf(el));
}
export function htmlSections(): HtmlSection[] {
  const sections: HtmlSection[] = [];
  const seen = new Map<HTMLElement, Set<string>>();
  const add = (el: HTMLElement, title: string) => {
    if (!title || !navigable(el) || sections.length >= 300 || seen.get(el)?.has(title)) return;
    if (!seen.has(el)) seen.set(el, new Set());
    seen.get(el)!.add(title);
    sections.push({ title, el, fingerprint: sectionFingerprint(el) });
  };
  for (const heading of document.querySelectorAll<HTMLElement>(
    'h1,h2,h3,h4,h5,h6,[role="heading"]',
  )) {
    if (!heading.closest('nav,[role="navigation"]')) add(heading, titleOf(heading));
  }
  for (const link of document.querySelectorAll<HTMLAnchorElement>('a[href*="#"]')) {
    if (!navigable(link)) continue;
    try {
      const url = new URL(link.href, location.href);
      if (
        url.origin !== location.origin ||
        url.pathname !== location.pathname ||
        url.search !== location.search ||
        !url.hash
      )
        continue;
      const id = decodeURIComponent(url.hash.slice(1));
      const target =
        document.getElementById(id) ||
        Array.from(document.getElementsByName(id)).find((el) => el instanceof HTMLAnchorElement);
      if (!(target instanceof HTMLElement)) continue;
      // An empty anchor directly before a heading is a common generated-document pattern.
      const heading = target.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')
        ? target
        : target.querySelector<HTMLElement>('h1,h2,h3,h4,h5,h6,[role="heading"]') ||
          (target.matches('a') &&
          !target.textContent?.trim() &&
          target.nextElementSibling?.matches('h1,h2,h3,h4,h5,h6,[role="heading"]')
            ? (target.nextElementSibling as HTMLElement)
            : undefined);
      add(heading || target, titleOf(link));
    } catch {
      /* Ignore malformed URLs and fragments. */
    }
  }
  return sections;
}
export function htmlSectionQuery(goal: string): string | undefined {
  return (
    goal
      .trim()
      .match(
        /^(?:go\s+to|jump\s+to|navigate\s+to|scroll\s+to)\s+(?:the\s+)?(?:section\s+)?(.+?)[.!?]?$/i,
      )?.[1] || goal.trim().match(/^(?:跳转到|跳到|转到|滚动到)\s*(.+?)[。！]?$/)?.[1]
  );
}
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/^(?:第[一二三四五六七八九十百\d]+[章节]\s*|\d+(?:\.\d+)*[.、\s]+|[a-z][.\s]+)/i, '')
    .replace(/[\p{P}\s]+/gu, ' ')
    .trim();
const synonyms = [
  ['appendix', 'appendices', '附录'],
  ['references', 'bibliography', '参考文献'],
  ['installation', 'install', '安装'],
  ['introduction', '引言', '简介'],
  ['conclusion', 'conclusions', '结论'],
  ['getting started', '快速开始', '入门'],
];
export function matchHtmlSections(sections: HtmlSection[], query: string): HtmlSection[] {
  const wanted = normalize(query);
  const equivalents = synonyms.find((group) => group.includes(wanted)) || [wanted];
  let matches = sections.filter((s) => equivalents.includes(normalize(s.title)));
  if (!matches.length && ['appendix', 'appendices', '附录'].includes(wanted)) {
    matches = sections.filter((s) => /^(?:appendix|appendices)\b|^附录/i.test(s.title)).slice(0, 1);
  }
  // Heading text and TOC text can name the same target; keep distinct destinations only.
  return matches.filter((s, i) => matches.findIndex((other) => other.el === s.el) === i);
}
