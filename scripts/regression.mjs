import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';
const plan = await readFile('jev_web_lens_implementation_plan.md', 'utf8');
const rows = plan
  .split('\n')
  .filter((line) => /^\| \d+ \|/.test(line))
  .map((line) => {
    const [, id, url, archetype, focus, challenge] = line.split('|').map((s) => s.trim());
    return {
      id: Number(id),
      url,
      archetype,
      focus,
      challenge,
      manual:
        /\*|file:|mail.google|docs.google.com\/document|figma.com|x.com\/|substack.com\/home/.test(
          url,
        ),
    };
  });
await mkdir('qa-results', { recursive: true });
await writeFile('tests/fixtures/regression-matrix.json', JSON.stringify(rows, null, 2) + '\n');
if (!process.argv.includes('--run')) {
  console.log(
    `Generated ${rows.length} cases. Use --run --ids=1,2,3 to run selected public pages in local Demo mode.`,
  );
  process.exit(0);
}
const requested = process.argv
  .find((a) => a.startsWith('--ids='))
  ?.slice(6)
  .split(',')
  .map(Number) || [1, 9, 17];
const profile = await mkdtemp(join(tmpdir(), 'jev-qa-'));
const extension = resolve('output/chrome-mv3');
const context = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  ignoreHTTPSErrors: false,
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
const extensionId = new URL(worker.url()).hostname;
const bridge = await context.newPage();
await bridge.goto(`chrome-extension://${extensionId}/sidepanel.html`);
const results = [];
try {
  for (const row of rows.filter((r) => requested.includes(r.id))) {
    if (row.manual) {
      results.push({
        ...row,
        status: 'manual',
        reason: 'Authentication, private app or wildcard route. Do not bypass access controls.',
      });
      continue;
    }
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const start = Date.now();
    try {
      const pdf = /pdf|arxiv.org\/pdf/.test(row.archetype + row.url);
      await page.goto(
        pdf
          ? `chrome-extension://${extensionId}/pdf-viewer.html?url=${encodeURIComponent(row.url)}`
          : row.url,
        { waitUntil: 'domcontentloaded', timeout: 25000 },
      );
      if (pdf)
        await page
          .locator('#status')
          .filter({ hasText: /pages ·|Could not open|no usable text/ })
          .waitFor({ timeout: 45000 });
      else await page.waitForTimeout(1800);
      const tabId = await worker.evaluate(
        async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id,
        page.url(),
      );
      const before = Date.now();
      const extraction = await bridge.evaluate(
        async (tabId) =>
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'PAGE',
            tabId,
            command: { type: 'EXTRACT', granularity: 'sentence' },
          }),
        tabId,
      );
      if (!extraction?.ok) throw new Error(extraction?.error || 'Extraction failed');
      const units = extraction.value.units;
      const scores = units
        .map((u) => ({
          unitId: u.unitId,
          score: Math.min(
            0.95,
            0.5 +
              (u.text.length > 70 ? 0.2 : 0) +
              (/train|install|important|must|result/i.test(u.text) ? 0.2 : 0),
          ),
          confidence: 0,
        }))
        .filter((u) => u.score >= 0.55)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.ceil(units.length * 0.2));
      await bridge.evaluate(
        async ({ tabId, documentId, scores }) =>
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'PAGE',
            tabId,
            command: { type: 'PAINT', documentId, items: scores, navigator: false },
          }),
        { tabId, documentId: extraction.value.documentId, scores },
      );
      results.push({
        ...row,
        status: units.length ? 'extracted' : 'limited',
        units: units.length,
        highlightedCount: scores.length,
        analysisLatencyMs: Date.now() - before,
        loadAndAnalysisMs: Date.now() - start,
        provider: 'local QA heuristic; no Jev call',
        errors,
        limitation: extraction.value.limited,
      });
      await page.screenshot({ path: `qa-results/${row.id}.png` });
    } catch (error) {
      results.push({ ...row, status: 'error', error: error.message, errors });
    }
    await page.close();
    await writeFile('qa-results/report.json', JSON.stringify(results, null, 2));
    console.log(`${row.id}: ${results.at(-1).status} (${results.at(-1).units || 0} units)`);
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
