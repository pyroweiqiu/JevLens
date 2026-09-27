export interface PdfSection {
  title: string;
  page: number;
  appendix: boolean;
  appendixKey?: string;
}
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, ' ')
    .trim();
const withoutNumber = (text: string) =>
  text.replace(/^(?:\d+(?:\.\d+)*|[a-z](?:\.\d+)*)(?:\s+|\.\s+)/i, '');
const appendixTitle = /^(?:appendix|appendices|附录)(?:\b|\s|$)/i;
export function sectionQuery(goal: string): string | undefined {
  const match =
    goal.trim().match(/^(?:go\s+to|jump\s+to|navigate\s+to|open)\s+(?:the\s+)?(.+?)[.!?]?$/i) ||
    goal.trim().match(/^(?:跳转到|跳到|转到|打开|去)\s*(.+?)[。！]?$/);
  return match?.[1].replace(/^section\s+/i, '').trim();
}
export function matchingSections<T extends PdfSection>(sections: T[], query: string): T[] {
  const wanted = normalize(query);
  const appendix = /^(appendix|appendices|附录)$/.test(wanted);
  if (appendix)
    return sections
      .filter((s) => s.appendix || appendixTitle.test(s.title))
      .sort((a, b) => a.page - b.page)
      .slice(0, 1);
  const appendixPart = wanted.match(/^(?:appendix|附录)\s*([a-z](?:\s+\d+)*)$/)?.[1];
  const exact = sections.filter(
    (s) => normalize(s.title) === wanted || normalize(withoutNumber(s.title)) === wanted,
  );
  if (exact.length) return exact;
  if (appendixPart)
    return sections.filter(
      (s) =>
        s.appendix &&
        (normalize(s.appendixKey || '') === appendixPart ||
          normalize(s.title).startsWith(appendixPart + ' ') ||
          normalize(s.title).startsWith('appendix ' + appendixPart + ' ') ||
          normalize(s.title) === 'appendix ' + appendixPart),
    );
  return [];
}

/** Resolve embedded PDF bookmarks. Never follow external bookmark URLs. */
export async function readPdfSections(
  pdf: import('pdfjs-dist').PDFDocumentProxy,
): Promise<PdfSection[]> {
  const outline = await pdf.getOutline();
  const sections: PdfSection[] = [];
  type Entry = NonNullable<typeof outline>[number];
  async function walk(items: Entry[], inheritedAppendix = false) {
    // Lettered sibling chapters (A ..., B ...) commonly omit the literal word Appendix.
    const lettered =
      items.some((i) => /^A[.\s]/.test(i.title)) && items.some((i) => /^B[.\s]/.test(i.title));
    for (const item of items) {
      const destinationKey =
        typeof item.dest === 'string'
          ? item.dest.match(
              /^(?:appendix|section|subsection|subsubsection)\.([A-Z](?:\.\d+)*)$/i,
            )?.[1]
          : undefined;
      const appendixKey =
        destinationKey || (lettered ? item.title.match(/^([A-Z](?:\.\d+)*)[.\s]/)?.[1] : undefined);
      const appendix =
        !!destinationKey ||
        inheritedAppendix ||
        appendixTitle.test(item.title) ||
        (lettered && /^[A-Z](?:\.|\s)/.test(item.title));
      try {
        const dest =
          typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (Array.isArray(dest) && dest[0] !== undefined) {
          const page =
            (typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])) + 1;
          if (page >= 1 && page <= pdf.numPages)
            sections.push({ title: item.title, page, appendix, appendixKey });
        }
      } catch {
        /* Broken bookmarks must not prevent rendering or text fallback. */
      }
      await walk(item.items || [], appendix);
    }
  }
  await walk(outline || []);
  return sections;
}

export function textSections(): (PdfSection & { el: HTMLElement })[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-jev-pdf-line]')).flatMap((el) => {
    const title = el.dataset.jevPdfLine?.trim() || '';
    const page = Number(el.closest<HTMLElement>('.pdf-page')?.dataset.pageNumber);
    // Only complete short lines; ignore TOC dot leaders and prose references to sections.
    if (!page || !title || title.length > 140 || /\.{3}|…|\s\d+\s*$/.test(title)) return [];
    return [{ title, page, appendix: appendixTitle.test(title), el }];
  });
}
