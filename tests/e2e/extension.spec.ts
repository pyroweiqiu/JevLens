import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
} from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { DEFAULT_SETTINGS } from '../../src/shared/types';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
let context: BrowserContext,
  worker: Worker,
  server: Server,
  base: string,
  extensionId: string,
  profile: string;
async function send<T>(tabId: number, command: unknown): Promise<T> {
  return worker.evaluate(
    async ({ tabId, command }) =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { target: 'page', command }, resolve);
      }),
    { tabId, command },
  ) as Promise<T>;
}
async function tabFor(page: Page) {
  return worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)!.id!,
    page.url(),
  );
}
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      readFileSync(
        req.url === '/workflow'
          ? 'tests/fixtures/workflow.html'
          : req.url === '/structured'
            ? 'tests/fixtures/structured.html'
            : 'tests/fixtures/article.html',
      ),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  profile = mkdtempSync(join(tmpdir(), 'jev-e2e-'));
  const extension = resolve('output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).hostname;
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server?.close(() => r()));
  if (profile) rmSync(profile, { recursive: true, force: true });
});
test('real content script extracts exact text, paints, tracks mutations and guards Cursor', async () => {
  const page = await context.newPage();
  await page.goto(base);
  await page.waitForTimeout(350);
  const tabId = await tabFor(page);
  const result = await send<any>(tabId, { type: 'EXTRACT', granularity: 'sentence' });
  expect(result.ok).toBe(true);
  expect(result.value.units.length).toBeGreaterThan(15);
  const unit = result.value.units.find((u: any) => u.text.includes('trained with human feedback'));
  expect(unit.text).toBe(
    'The model is trained with human feedback to identify important information.',
  );
  expect(JSON.stringify(result.value)).not.toContain('Private draft');
  expect(
    (
      await send<any>(tabId, {
        type: 'PAINT',
        documentId: result.value.documentId,
        navigator: false,
        items: [{ unitId: unit.unitId, score: 0.95, confidence: 0.8 }],
      })
    ).ok,
  ).toBe(true);
  // Custom highlight registries belong to the isolated content-script world; inspect its emitted style and screenshot.
  expect(await page.locator('style[data-jev-ui]').evaluate((el) => el.textContent)).toContain(
    'jev-critical',
  );
  await send(tabId, { type: 'SELECT', id: unit.unitId });
  await page.screenshot({ path: 'test-results/article-highlight.png' });
  await page.evaluate(() => window.scrollTo(0, 0));
  expect(
    await page.locator('#safe').evaluate((el) => el.getBoundingClientRect().top > innerHeight),
  ).toBe(true);
  const actions = await send<any>(tabId, { type: 'ACTIONS' });
  const safe = actions.value.find((a: any) => a.accessibleName === 'Open installation guide');
  expect((await send<any>(tabId, { type: 'EXECUTE', id: safe.id, approved: true })).ok).toBe(false);
  await send(tabId, { type: 'PROPOSE', id: safe.id });
  expect((await send<any>(tabId, { type: 'EXECUTE', id: safe.id, approved: true })).ok).toBe(true);
  await expect(page.locator('#safe')).toHaveText('Guide opened');
  await page.evaluate(() => {
    history.pushState({}, '', '/next');
    document.querySelector('#inline')!.innerHTML =
      'A changed route contains a different important training result.';
  });
  const next = await send<any>(tabId, { type: 'EXTRACT', granularity: 'paragraph' });
  expect(next.value.documentId).not.toBe(result.value.documentId);
  expect(next.value.units.some((u: any) => u.text.includes('changed route'))).toBe(true);
  await page.close();
});
test('side panel renders real results, searches, clears and changes precision', async () => {
  const page = await context.newPage();
  await page.goto(base + '/ui');
  await page.waitForTimeout(300);
  const targetId = await tabFor(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  // A panel opened as a test tab must follow the article, just like a native side panel.
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), targetId);
  await expect(panel.locator('.highlight-card').first()).toBeVisible({ timeout: 15000 });
  await expect(panel.locator('.demo-note')).toContainText('no AI requests');
  await panel.getByRole('button', { name: /Find\s*02/ }).click();
  await expect(panel.getByRole('button', { name: /Find\s*02/ })).toHaveClass('active');
  await expect(panel.locator('.mode-guide')).toContainText('找原文');
  await panel.locator('.mode-guide .example-chips button').first().click();
  await expect(panel.getByRole('textbox', { name: 'Intent' })).not.toHaveValue('');
  await panel.screenshot({ path: 'test-results/sidepanel.png' });
  await panel.getByRole('textbox', { name: 'Intent' }).fill('training GPUs');
  await panel.getByRole('button', { name: 'Find passages' }).click();
  await expect(panel.locator('.intent-label')).toContainText('training GPUs');
  await expect(panel.locator('.highlight-card').first()).toContainText(/Training|training/);
  await panel.getByRole('button', { name: 'Clear intent' }).click();
  await expect(panel.locator('.intent-label')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Paragraph', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Paragraph', exact: true })).toHaveClass('active');
  await panel.close();
  await page.close();
});
test('owned PDF viewer renders a text layer and serves shared extraction', async () => {
  const source = await context.newPage();
  await source.goto(base + '/pdf-source');
  const bytes = await source.pdf({ format: 'A4' });
  await source.close();
  const viewer = await context.newPage();
  await viewer.goto(`chrome-extension://${extensionId}/pdf-viewer.html`);
  await viewer
    .locator('#file')
    .setInputFiles({ name: 'lens-fixture.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(viewer.locator('#status')).toContainText('pages ·', { timeout: 20000 });
  const tabId = await tabFor(viewer);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const result = await panel.evaluate(
    async (tabId) =>
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'PAGE',
        tabId,
        command: { type: 'EXTRACT', granularity: 'sentence' },
      }),
    tabId,
  );
  expect(result.ok).toBe(true);
  expect(result.value.units.length).toBeGreaterThan(5);
  expect(result.value.units[0].locator.kind).toBe('pdf-text');
  expect(result.value.sensitive).toBe(true);
  const textLayerFont = await viewer
    .locator('[data-jev-pdf-block] span')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(textLayerFont).toBeGreaterThan(15);
  const passage = result.value.units.find((u: any) =>
    u.text.includes('trained with human feedback'),
  );
  expect(passage).toBeTruthy();
  await panel.evaluate(
    async ({ tabId, documentId, unitId }) => {
      await chrome.runtime.sendMessage({
        target: 'background',
        type: 'PAGE',
        tabId,
        command: {
          type: 'PAINT',
          documentId,
          items: [{ unitId, score: 0.95, confidence: 0.8 }],
          navigator: true,
        },
      });
      await chrome.runtime.sendMessage({
        target: 'background',
        type: 'PAGE',
        tabId,
        command: { type: 'SELECT', id: unitId },
      });
    },
    { tabId, documentId: result.value.documentId, unitId: passage.unitId },
  );
  expect(await viewer.evaluate(() => CSS.highlights.get('jev-navigator')?.size)).toBeGreaterThan(0);

  await viewer.screenshot({ path: 'test-results/pdf-viewer.png' });
  await panel.close();
  await viewer.close();
});

test('Act finds an offscreen control, previews it and waits for approval', async () => {
  const page = await context.newPage();
  await page.goto(base + '/offscreen');
  const id = await tabFor(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
  await expect(panel.locator('.highlight-card').first()).toBeVisible();
  await panel.getByRole('button', { name: /Act\s*03/ }).click();
  await expect(panel.locator('.cursor-card .example-chips button').first()).toBeVisible();
  await panel.getByRole('textbox', { name: 'Intent' }).fill('Open installation guide');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await expect(panel.locator('.proposal h3')).toHaveText('Open installation guide');
  await expect(page.locator('#safe')).toBeInViewport();
  await expect(page.locator('#safe')).toHaveText('Open installation guide');
  await panel.screenshot({ path: 'test-results/act-preview.png' });
  await panel.getByRole('button', { name: 'Approve & click' }).click();
  await expect(page.locator('#safe')).toHaveText('Guide opened');
  await panel.close();
  await page.close();
});

test('PDF Act navigates to page 10 in English and Chinese, and explains invalid pages', async () => {
  const source = await context.newPage();
  await source.setContent(
    Array.from(
      { length: 12 },
      (_, i) =>
        `<section style="break-before:${i ? 'page' : 'auto'}"><h1>${i === 9 ? 'Appendix' : 'Chapter ' + (i + 1)}</h1><p>Important information on page ${i + 1} of the navigation fixture.</p></section>`,
    ).join(''),
  );
  const bytes = await source.pdf({ format: 'A4' });
  await source.close();
  const viewer = await context.newPage();
  await viewer.goto(`chrome-extension://${extensionId}/pdf-viewer.html`);
  await viewer
    .locator('#file')
    .setInputFiles({ name: 'navigation.pdf', mimeType: 'application/pdf', buffer: bytes });
  await expect(viewer.locator('#status')).toContainText('12 pages');
  const id = await tabFor(viewer);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
  await expect(panel.locator('.page-context h1')).toHaveText('navigation.pdf');
  await panel.getByRole('button', { name: /Act\s*03/ }).click();
  for (const goal of ['go to page 10', '跳到第10页', 'go to Appendix', '跳到附录']) {
    await viewer.evaluate(() => window.scrollTo(0, 0));
    await panel.getByRole('textbox', { name: 'Intent' }).fill(goal);
    await panel.getByRole('button', { name: 'Suggest action' }).click();
    await expect(panel.locator('.proposal h3')).toHaveText(/Go to (?:page 10|Appendix · page 10)/);
    expect(await viewer.evaluate(() => window.scrollY)).toBe(0);
    await panel.getByRole('button', { name: 'Approve & go' }).click();
    await expect(viewer.locator('[data-page-number="10"]')).toBeInViewport();
    await expect(panel.getByRole('status')).toContainText('page 10');
  }
  await panel.screenshot({ path: 'test-results/pdf-navigation.png' });
  await panel.getByRole('textbox', { name: 'Intent' }).fill('go to page 99');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await expect(panel.locator('.workflow-message')).toContainText('PDF page 99 is unavailable');
  await expect(panel.getByRole('button', { name: 'Approve & go' })).toHaveCount(0);
  await panel.close();
  await viewer.close();
});

test('HTML outline navigates headings, TOC anchors and duplicate titles with explicit approval', async () => {
  const page = await context.newPage();
  await page.goto(base + '/structured');
  const id = await tabFor(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
  await expect(panel.locator('.highlight-card').first()).toBeVisible();
  await panel.getByRole('button', { name: /Act\s*03/ }).click();
  await expect(panel.locator('.section-navigation')).toContainText('本页目录');
  await panel.getByLabel('候选动作类型').selectOption('section');
  await panel
    .locator('.section-navigation')
    .getByRole('button', { name: 'API table', exact: true })
    .click();
  await expect(panel.getByRole('textbox', { name: 'Intent' })).toHaveValue('go to API table');
  for (const [goal, selector] of [
    ['go to API table', '#api'],
    ['跳到安装', '#install'],
    ['go to References', '#references'],
  ]) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await panel.getByRole('textbox', { name: 'Intent' }).fill(goal);
    await panel.getByRole('button', { name: 'Suggest action' }).click();
    await expect(panel.getByRole('button', { name: 'Approve & go' })).toBeVisible();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await panel.getByRole('button', { name: 'Approve & go' }).click();
    await expect(page.locator(selector)).toBeInViewport();
    await expect(panel.getByRole('status')).toContainText('Moved to');
  }
  expect(await page.locator('body').getAttribute('data-link-clicked')).toBeNull();
  expect(page.url()).toBe(base + '/structured');
  await panel.getByRole('textbox', { name: 'Intent' }).fill('go to FAQ');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await expect(panel.locator('.proposal h3')).toContainText('match 1');
  await expect(panel.locator('.proposal')).toContainText('2 个同名章节');
  await panel.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(panel.locator('.proposal h3')).toContainText('match 2');
  await panel.getByRole('button', { name: 'Approve & go' }).click();
  await expect(page.getByRole('heading', { name: 'FAQ', exact: true }).nth(1)).toBeInViewport();
  await panel.locator('.section-navigation summary').click();
  await panel
    .locator('.section-navigation')
    .getByRole('button', { name: 'FAQ · match 2', exact: true })
    .click();
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await expect(panel.locator('.proposal h3')).toContainText('match 2');
  await panel.screenshot({ path: 'test-results/html-section-navigation.png' });
  await panel.getByRole('textbox', { name: 'Intent' }).fill('go to Missing');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await expect(panel.locator('.workflow-message')).toContainText('No section matching');
  await panel.close();
  await page.close();
});

test('optional source paper: Appendix bookmark resolves to the actual appendix, not prose references', async () => {
  test.skip(
    !process.env.JEV_PDF_QA_PATH,
    'Set JEV_PDF_QA_PATH to the downloaded arXiv 2609.13356 PDF',
  );
  const viewer = await context.newPage();
  await viewer.goto(`chrome-extension://${extensionId}/pdf-viewer.html`);
  await viewer.locator('#file').setInputFiles(process.env.JEV_PDF_QA_PATH!);
  await expect(viewer.locator('#status')).toContainText('48 pages', { timeout: 45000 });
  const id = await tabFor(viewer);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
  await expect(panel.locator('.highlight-card').first()).toBeVisible({ timeout: 15000 });
  await panel.getByRole('button', { name: /Act\s*03/ }).click();
  for (const goal of ['go to Appendix', '跳到附录', 'go to Pre-Training Details']) {
    await viewer.evaluate(() => window.scrollTo(0, 0));
    await panel.getByRole('textbox', { name: 'Intent' }).fill(goal);
    await panel.getByRole('button', { name: 'Suggest action' }).click();
    await expect(panel.locator('.proposal h3')).toHaveText('Go to Pre-Training Details · page 30');
    expect(await viewer.evaluate(() => window.scrollY)).toBe(0);
    await panel.getByRole('button', { name: 'Approve & go' }).click();
    await expect(viewer.locator('[data-page-number="30"]')).toBeInViewport();
    await expect(panel.getByRole('status')).toContainText('page 30');
  }
  await viewer.screenshot({ path: 'test-results/source-paper-appendix.png' });
  await panel.screenshot({ path: 'test-results/source-paper-appendix-panel.png' });
  await panel.close();
  await viewer.close();
});

test('API settings switches providers, tests native decisions, isolates keys and saves only on confirmation', async () => {
  const requests: { url: string; model: string; token: string; state: string }[] = [];
  const handleApi = async (route: import('@playwright/test').Route) => {
    const request = route.request();
    const body = request.postDataJSON();
    requests.push({
      url: request.url(),
      model: body.model,
      token: request.headers().authorization,
      state: body.state,
    });
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([id, q]: [string, any]) => [
        id,
        q.type === 'choice'
          ? {
              type: 'choice',
              choice: Object.keys(q.criteria)[0],
              confidence: 0.9,
              probabilities: Object.fromEntries(
                Object.keys(q.criteria).map((key, i) => [key, i === 0 ? 1 : 0]),
              ),
            }
          : { type: 'score', score: 2.7, confidence: 0.9, probabilities: { '2': 0.3, '3': 0.7 } },
      ]),
    );
    await route.fulfill({ json: { answers, usage: { input_tokens: 20, output_tokens: 4 } } });
  };
  await context.route('https://api.typesafe.ai/v1/systemone', handleApi);
  await context.route('https://openrouter.ai/api/alpha/decisions', handleApi);
  await context.route(base + '/decisions', handleApi);
  const page = await context.newPage();
  await page.goto(base + '/api-settings');
  const tabId = await tabFor(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  await expect(panel.locator('.highlight-card').first()).toBeVisible();
  const trigger = panel.getByRole('button', { name: 'API settings', exact: true });
  const inputBox = await panel.getByRole('textbox', { name: 'Intent' }).boundingBox();
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox!.y + triggerBox!.height).toBeLessThanOrEqual(inputBox!.y);
  await trigger.click();
  const dialog = panel.getByRole('dialog', { name: 'API settings' });
  await dialog.getByRole('radio', { name: /OpenRouter/ }).check();
  await dialog.getByLabel('API Key', { exact: true }).fill('discard-this-key');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(trigger).toContainText('Demo');
  expect(requests).toHaveLength(0);
  await trigger.click();
  await dialog.getByRole('radio', { name: /Jev Official/ }).check();
  await expect(dialog.getByLabel('Endpoint URL')).toHaveValue(
    'https://api.typesafe.ai/v1/systemone',
  );
  await expect(dialog.getByLabel('Model ID')).toHaveValue('jev-latest');
  await dialog.getByLabel('API Key', { exact: true }).fill('official-test-key');
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('responses verified');
  await dialog.getByRole('radio', { name: /OpenRouter/ }).check();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(dialog.getByLabel('Model ID')).toHaveValue('typesafe/jev-1.13');
  await dialog.getByLabel('API Key', { exact: true }).fill('openrouter-test-key');
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('responses verified');
  await dialog.getByRole('radio', { name: /Custom/ }).check();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Endpoint URL').fill(base + '/decisions');
  await dialog.getByLabel('Model ID').fill('test-custom-jev');
  await dialog.getByLabel('API Key', { exact: true }).fill('custom-test-key');
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('responses verified');
  await panel.screenshot({ path: 'test-results/api-settings.png' });
  expect(requests).toHaveLength(6);
  expect(requests.map((r) => r.model)).toEqual([
    'jev-latest',
    'jev-latest',
    'typesafe/jev-1.13',
    'typesafe/jev-1.13',
    'test-custom-jev',
    'test-custom-jev',
  ]);
  expect(requests.map((r) => r.token)).toEqual([
    'Bearer official-test-key',
    'Bearer official-test-key',
    'Bearer openrouter-test-key',
    'Bearer openrouter-test-key',
    'Bearer custom-test-key',
    'Bearer custom-test-key',
  ]);
  expect(requests.every((r) => !r.state.includes('A field guide to focused reading'))).toBe(true);
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toContainText('Custom API');
  await expect(panel.locator('.notice')).toContainText('enable page sharing');
  expect(requests).toHaveLength(6);
  await panel.reload();
  await trigger.click();
  await expect(dialog.getByLabel('Endpoint URL')).toHaveValue(base + '/decisions');
  await dialog.getByRole('radio', { name: /Jev Official/ }).check();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('official-test-key');
  await dialog.getByRole('radio', { name: /OpenRouter/ }).check();
  await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('openrouter-test-key');
  await dialog.getByRole('radio', { name: /Custom/ }).check();
  await dialog.getByRole('checkbox', { name: /Allow visible page text/ }).check();
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await expect(panel.locator('.highlight-card').first()).toBeVisible();
  expect(
    requests.some(
      (r) => r.model === 'test-custom-jev' && r.state.includes('A field guide to focused reading'),
    ),
  ).toBe(true);
  await panel.close();
  await page.close();
});

test('workflow executes one approved step at a time and refreshes dynamic candidates', async () => {
  await worker.evaluate((settings) => chrome.storage.local.set({ settings }), DEFAULT_SETTINGS);
  const page = await context.newPage();
  await page.goto(base + '/workflow');
  const id = await tabFor(page);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), id);
  await expect(panel.locator('.highlight-card').first()).toBeVisible();
  await panel.getByRole('button', { name: /Act\s*03/ }).click();
  await panel
    .getByLabel('计划草稿')
    .fill('点击 "Reveal details"; 点击 "Next section"; 查找 GPUs; 回到顶部');
  await panel.getByRole('button', { name: '生成计划', exact: true }).click();
  await expect(panel.locator('.workflow-plan li')).toHaveCount(4);
  await expect(panel.locator('.proposal h3')).toHaveText('Reveal details');
  await expect(page.locator('#next')).toBeHidden();
  await panel.getByRole('button', { name: 'Approve & click' }).click();
  await expect(page.locator('#next')).toBeVisible();
  await expect(panel.locator('.workflow-plan')).toContainText('1/4');
  await expect(page.locator('#next')).not.toHaveAttribute('data-executed', 'true');
  await expect(panel.locator('.catalog-list')).toContainText('Next section');
  await panel.getByRole('button', { name: '推荐当前步骤', exact: true }).click();
  await expect(panel.locator('.proposal h3')).toHaveText('Next section');
  await panel.getByRole('button', { name: 'Approve & click' }).click();
  await expect(page.locator('#next')).toHaveAttribute('data-executed', 'true');
  await expect(panel.locator('.workflow-plan')).toContainText('2/4');
  await panel.getByRole('button', { name: '推荐当前步骤', exact: true }).click();
  await expect(panel.locator('.proposal h3')).toContainText('定位');
  await panel.getByRole('button', { name: '确认执行当前步骤', exact: true }).click();
  await expect(panel.locator('.workflow-plan')).toContainText('3/4');
  await panel.getByRole('button', { name: '推荐当前步骤', exact: true }).click();
  await expect(panel.locator('.proposal h3')).toHaveText('scroll to top');
  await panel.getByRole('button', { name: 'Approve & go' }).click();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  await expect(panel.locator('.workflow-plan')).toContainText('4/4');
  await panel.screenshot({ path: 'test-results/workflow-completed.png' });
  await panel
    .getByLabel('计划草稿')
    .fill('如果页面包含 "missing condition" 就点击 Delete account; 回到顶部');
  await panel.getByRole('button', { name: '生成计划', exact: true }).click();
  await expect(panel.locator('.workflow-message')).toContainText('条件未满足');
  await expect(panel.locator('.proposal')).toHaveCount(0);
  await panel.getByLabel('计划草稿').fill('点击 Delete account');
  await panel.getByRole('button', { name: '生成计划', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Approve & click' })).toBeDisabled();
  await expect(page.locator('#danger')).not.toHaveAttribute('data-executed', 'true');
  await panel.getByLabel('计划草稿').fill('等待 5 秒; 点击 Next section');
  await panel.getByRole('button', { name: '生成计划', exact: true }).click();
  await panel.getByRole('button', { name: '确认执行当前步骤', exact: true }).click();
  await panel.getByRole('button', { name: /Stop Cursor/ }).click();
  await expect(panel.locator('.workflow-message')).toContainText('已停止');
  await expect(panel.locator('.workflow-plan')).toContainText('0/2');
  await expect(panel.locator('.proposal')).toHaveCount(0);
  await panel.close();
  await page.close();
});
