/** Preserve PDF.js span positioning while reconstructing paragraphs across wrapped lines. */
export function groupPdfTextLayer(container: HTMLElement) {
  const children = Array.from(container.childNodes);
  const lines: { nodes: Node[]; rect?: DOMRect }[] = [];
  let nodes: Node[] = [];
  const flush = () => {
    if (!nodes.length) return;
    const first = nodes.find((n) => n instanceof HTMLElement && n.tagName !== 'BR') as
      HTMLElement | undefined;
    if (first)
      first.dataset.jevPdfLine = nodes
        .map((n) => n.textContent || '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim();
    lines.push({ nodes, rect: first?.getBoundingClientRect() });
    nodes = [];
  };
  for (const child of children) {
    nodes.push(child);
    if (child instanceof HTMLBRElement) flush();
  }
  flush();
  let group: HTMLDivElement | undefined;
  let previous: DOMRect | undefined;
  for (const line of lines) {
    const r = line.rect;
    const newParagraph =
      !group ||
      !r ||
      !previous ||
      r.top < previous.top - 2 ||
      r.top - previous.top > Math.max(previous.height, r.height) * 1.9 ||
      Math.abs(r.left - previous.left) > Math.max(80, r.height * 5);
    if (newParagraph) {
      group = document.createElement('div');
      group.dataset.jevPdfBlock = 'true';
      group.className = 'markedContent';
      group.style.display = 'contents';
      container.append(group);
    } else group!.append(document.createTextNode(' '));
    for (const node of line.nodes) group!.append(node);
    previous = r;
  }
}
