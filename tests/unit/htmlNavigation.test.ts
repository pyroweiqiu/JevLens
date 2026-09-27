import { beforeEach, describe, expect, it, vi } from 'vitest';
import { htmlSections, htmlSectionQuery, matchHtmlSections } from '../../src/cursor/htmlNavigation';
import { ActionController } from '../../src/cursor/actions';
beforeEach(() => {
  document.body.innerHTML = '';
  vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([
    { width: 100, height: 20 },
  ] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 100,
    height: 20,
  } as DOMRect);
  Element.prototype.scrollIntoView = vi.fn();
});
describe('HTML section navigation', () => {
  it('reads numbered headings, ARIA headings, and same-document TOC targets without IDs on headings', () => {
    document.body.innerHTML =
      '<nav><a href="#install">Install guide</a><a href="#api">API table</a><a href="https://other.example/#missing">External chapter</a></nav><h2 id="install">2. Installation</h2><div id="api">Configuration table</div><div role="heading">参考文献</div><h3>No ID needed</h3>';
    const sections = htmlSections();
    expect(matchHtmlSections(sections, '安装')[0].el.id).toBe('install');
    expect(matchHtmlSections(sections, 'Install guide')[0].el.id).toBe('install');
    expect(matchHtmlSections(sections, 'API table')[0].el.id).toBe('api');
    expect(matchHtmlSections(sections, 'References')[0].title).toBe('参考文献');
    expect(matchHtmlSections(sections, 'No ID needed')).toHaveLength(1);
    expect(sections.some((s) => s.title === 'External chapter')).toBe(false);
    expect(htmlSectionQuery('跳到安装')).toBe('安装');
    expect(htmlSectionQuery('go to References')).toBe('References');
    expect(htmlSectionQuery('Open installation guide')).toBeUndefined();
    document.body.innerHTML = '<h2>Appendix A: Extra details</h2><h2>Appendix B: Data</h2>';
    expect(matchHtmlSections(htmlSections(), '附录')[0].title).toBe('Appendix A: Extra details');
  });
  it('ignores hidden, editable and form content, malformed fragments and unresolved TOC entries', () => {
    document.body.innerHTML =
      '<h2>Public <span hidden>secret</span></h2><h2 hidden>Private</h2><form><h2>Draft</h2></form><div contenteditable><h2>Editable</h2></div><a href="#%ZZ">Invalid</a><a href="#missing">Missing</a>';
    expect(htmlSections().map((s) => s.title)).toEqual(['Public']);
  });
  it('handles encoded and legacy named anchors without executing link handlers', () => {
    document.body.innerHTML =
      '<nav><a href="#%E5%AE%89%E8%A3%85">Setup</a><a href="#legacy">Old section</a></nav><h2 id="安装">安装</h2><a name="legacy"></a><h2>Legacy section</h2>';
    expect(matchHtmlSections(htmlSections(), 'Setup')[0].el.id).toBe('安装');
    expect(matchHtmlSections(htmlSections(), 'Old section')[0].el.tagName).toBe('H2');
  });
  it('requires approval, distinguishes repeated titles, and rejects changed or hidden targets', () => {
    document.body.innerHTML = '<h2>FAQ</h2><h2>FAQ</h2>';
    const controller = new ActionController();
    const candidates = controller.extract('go to FAQ');
    expect(candidates).toHaveLength(2);
    expect(candidates[0].fingerprint).not.toBe(candidates[1].fingerprint);
    const explicit = new ActionController().extract(candidates[1].navigationGoal!);
    expect(explicit).toHaveLength(1);
    expect(explicit[0].fingerprint).toBe(candidates[1].fingerprint);
    expect(() => controller.execute(candidates[0].id, true)).toThrow(/fresh/);
    controller.propose(candidates[0].id);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    controller.execute(candidates[0].id, true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledOnce();
    const [target] = controller.extract('go to FAQ');
    controller.propose(target.id);
    document.querySelector('h2')!.textContent = 'Changed';
    expect(() => controller.execute(target.id, true)).toThrow(/changed/);
    const [remaining] = controller.extract('go to FAQ');
    controller.propose(remaining.id);
    document.querySelectorAll('h2')[1].hidden = true;
    expect(() => controller.execute(remaining.id, true)).toThrow(/hidden/);
    expect(() => controller.extract('go to Missing')).toThrow(/No section/);
  });
});
