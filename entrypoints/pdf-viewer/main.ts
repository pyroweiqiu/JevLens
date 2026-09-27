import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { createPageRuntime } from '../../src/messaging/pageRuntime';
import './style.css';
import { readPdfSections } from '../../src/cursor/pdfNavigation';
import { groupPdfTextLayer } from '../../src/extraction/pdfTextLayer';
GlobalWorkerOptions.workerSrc = workerUrl;
const status = document.querySelector<HTMLElement>('#status')!;
const pages = document.querySelector<HTMLElement>('#pages')!;
let runtime = createPageRuntime((event) => port?.postMessage({ event }), { pdf: true });
let port: chrome.runtime.Port;
function connect() {
  port = chrome.runtime.connect({ name: 'jev-pdf' });
  port.onMessage.addListener((m) => {
    if (m.command) port.postMessage({ id: m.id, reply: runtime.handle(m.command) });
  });
  port.onDisconnect.addListener(() => setTimeout(connect, 500));
}
connect();
document.querySelector('#lens')!.addEventListener('click', () => {
  void chrome.tabs
    .getCurrent()
    .then((tab) => {
      if (tab?.windowId !== undefined) return chrome.sidePanel.open({ windowId: tab.windowId });
    })
    .catch(() => {
      status.textContent = 'Use the Jev toolbar icon to open Lens.';
    });
});
let generation = 0;
let destroyPdf: (() => Promise<void>) | undefined;
async function load(data: Uint8Array | string, name: string) {
  const version = ++generation;
  runtime.destroy();
  await destroyPdf?.();
  pages.replaceChildren();
  status.textContent = 'Opening PDF…';
  document.title = name;
  document.documentElement.dataset.jevLoading = 'true';
  document.documentElement.dataset.sourceUrl =
    typeof data === 'string' ? data : `file:///${encodeURIComponent(name)}`;
  runtime = createPageRuntime((event) => port.postMessage({ event }), { pdf: true });
  try {
    const task = getDocument(
      typeof data === 'string' ? { url: data, withCredentials: false } : { data },
    );
    destroyPdf = () => task.destroy();
    const pdf = await task.promise;
    const sections = await readPdfSections(pdf).catch(() => []);
    if (version !== generation) return;
    let chars = 0;
    let lastProgress = performance.now();
    for (let i = 1; i <= pdf.numPages; i++) {
      if (version !== generation) return;
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.3 });
      const section = document.createElement('section');
      section.className = 'pdf-page';
      section.dataset.pageNumber = String(i);
      section.dataset.pdfSections = JSON.stringify(sections.filter((s) => s.page === i));
      section.style.width = `${viewport.width}px`;
      section.style.height = `${viewport.height}px`;
      section.style.setProperty('--scale-factor', String(viewport.scale));
      section.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit));
      const canvas = document.createElement('canvas');
      // PDF.js lazily changes canvas styles while scrolling; those are rendering, not document edits.
      canvas.dataset.jevUi = 'true';
      const dpr = Math.min(devicePixelRatio, 2);
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const textDiv = document.createElement('div');
      textDiv.className = 'textLayer';
      section.append(canvas, textDiv);
      pages.append(section);
      // Text for all pages becomes navigable; canvas rendering is viewport-lazy.
      const text = await page.getTextContent();
      chars += text.items.reduce((n, item) => n + ('str' in item ? item.str.trim().length : 0), 0);
      await new TextLayer({ textContentSource: text, container: textDiv, viewport }).render();
      groupPdfTextLayer(textDiv);
      const io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            io.disconnect();
            void page
              .render({
                canvas,
                canvasContext: canvas.getContext('2d')!,
                viewport,
                transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
              })
              .promise.catch(() => {});
          }
        },
        { rootMargin: '1500px' },
      );
      io.observe(section);
      status.textContent = `Reading page ${i} / ${pdf.numPages}`;
      if (i === 1 || performance.now() - lastProgress > 1800) {
        lastProgress = performance.now();
        port.postMessage({ event: { type: 'PAGE_CHANGED' } });
      }
    }
    status.textContent = chars
      ? `${pdf.numPages} pages · Select passages in the Lens side panel. PDF reading order may vary in complex layouts.`
      : 'This PDF has no usable text layer. OCR is not enabled.';
    delete document.documentElement.dataset.jevLoading;
    port.postMessage({ event: { type: 'PAGE_CHANGED' } });
  } catch (e) {
    delete document.documentElement.dataset.jevLoading;
    if (version === generation)
      status.textContent = `Could not open PDF: ${(e as Error).message}. Download it and use Open local PDF.`;
  }
}
document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) await load(new Uint8Array(await file.arrayBuffer()), file.name);
});
const source = new URL(location.href).searchParams.get('url');
const mime = (
  chrome as unknown as {
    mimeHandler?: {
      getStreamInfo(): Promise<{ streamUrl: string; originalUrl: string }>;
      abortAndFallbackToNativeHandler(): Promise<void>;
    };
  }
).mimeHandler;
if (source && /^https?:\/\//i.test(source))
  void load(
    source,
    decodeURIComponent(new URL(source).pathname.split('/').pop() || 'PDF document'),
  );
else if (mime)
  void mime
    .getStreamInfo()
    .then(async (info) => {
      const response = await fetch(info.streamUrl);
      if (!response.ok) throw new Error('PDF stream unavailable');
      await load(
        new Uint8Array(await response.arrayBuffer()),
        info.originalUrl.split('/').pop() || 'PDF document',
      );
      document.documentElement.dataset.sourceUrl = info.originalUrl;
    })
    .catch(() => {
      /* Manually opened viewer has no MIME stream. */
    });
