import { describe, expect, it } from 'vitest';
import {
  matchingSections,
  readPdfSections,
  sectionQuery,
  textSections,
} from '../../src/cursor/pdfNavigation';
import type { PDFDocumentProxy } from 'pdfjs-dist';

describe('PDF section navigation', () => {
  it('resolves Appendix aliases from named destinations, independent of bookmark titles', async () => {
    const sections = await readPdfSections({
      numPages: 48,
      getOutline: async () => [
        { title: 'Introduction', dest: 'section.1', items: [] },
        {
          title: 'Pre-Training Details',
          dest: 'appendix.A',
          items: [{ title: 'Training Configuration', dest: 'subsection.A.1', items: [] }],
        },
        { title: 'Post-Training Details', dest: 'appendix.B', items: [] },
        { title: 'Broken bookmark', dest: 'broken', items: [] },
      ],
      getDestination: async (name: string) =>
        ({ 'section.1': [1], 'appendix.A': [29], 'subsection.A.1': [29], 'appendix.B': [33] })[
          name
        ] || null,
    } as unknown as PDFDocumentProxy);
    expect(matchingSections(sections, 'Appendix')[0]).toMatchObject({
      title: 'Pre-Training Details',
      page: 30,
    });
    expect(matchingSections(sections, '附录')[0].page).toBe(30);
    expect(matchingSections(sections, 'Appendix B').map((s) => s.page)).toEqual([34]);
    expect(matchingSections(sections, 'Appendix A.1')[0].title).toBe('Training Configuration');
    expect(matchingSections(sections, 'Pre-Training Details')[0].page).toBe(30);
    expect(matchingSections(sections, 'Missing chapter')).toEqual([]);
  });
  it('uses short heading lines as fallback, not earlier prose mentions or TOC dot leaders', () => {
    document.body.innerHTML =
      '<section class="pdf-page" data-page-number="2"><span data-jev-pdf-line="See Appendix for further details."></span><span data-jev-pdf-line="Appendix .... 10"></span></section><section class="pdf-page" data-page-number="10"><span data-jev-pdf-line="Appendix"></span></section>';
    expect(matchingSections(textSections(), 'Appendix').map((s) => s.page)).toEqual([10]);
    expect(sectionQuery('go to Appendix')).toBe('Appendix');
    expect(sectionQuery('跳到附录')).toBe('附录');
    expect(sectionQuery('delete Appendix')).toBeUndefined();
  });
});
