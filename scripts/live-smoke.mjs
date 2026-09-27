// Explicit opt-in live test. Reads the key in-process; never prints it or records request headers.
// Uses a disposable browser profile, fixed local fixtures and one public MDN page.
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const report = { startedAt: new Date().toISOString(), checks: [], requests: [], observations: [] };
const output = 'qa-results/live-openrouter';
let key = '',
  context,
  server,
  profile;
let step = 'initialization';
const endpoint = 'https://openrouter.ai/api/alpha/decisions';
const redact = (value) =>
  String(value)
    .replaceAll(key || 'NONEXISTENT_SECRET', '[REDACTED]')
    .replace(/sk-or-v1-[A-Za-z0-9_-]+/g, '[REDACTED]');
const pending = new Set();
let attempts = 0;
function record(name, details) {
  report.checks.push({ name, ...details });
  console.log(redact(JSON.stringify({ check: name, ...details })));
}
async function save() {
  const json = redact(JSON.stringify(report, null, 2));
  await writeFile(join(output, 'report.json'), json + '\n');
}
try {
  const source = await readFile(resolve(process.argv[2] || 'conf/jev_openrouter_keys.txt'), 'utf8');
  const keys = [...new Set(source.match(/sk-or-v1-[A-Za-z0-9_-]+/g) || [])];
  if (keys.length !== 1)
    throw new Error('Expected exactly one OpenRouter key in the configured file.');
  key = keys[0];
  await mkdir(output, { recursive: true });
  const html = await readFile('tests/fixtures/article.html');
  server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  profile = await mkdtemp(join(tmpdir(), 'jev-live-'));
  const extension = resolve('output/chrome-mv3');
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).hostname;
  // Check credentials on OpenRouter's own origin. Return only status, never account data.
  step = 'authentication';
  const authPage = await context.newPage();
  await authPage.goto('https://openrouter.ai/api/v1/models', {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  const authStatus = await authPage.evaluate(async (token) => {
    const response = await fetch('/api/v1/key', {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    return response.status;
  }, key);
  await authPage.close();
  report.observations.push({ check: 'OpenRouter key authentication', status: authStatus });
  if (authStatus !== 200)
    throw new Error(
      `OpenRouter key authentication returned HTTP ${authStatus}. Live inference checks were not run.`,
    );
  record(step, { passed: true, status: authStatus });
  // Requests are unmodified and hit the real API. A hard request cap bounds accidental loops.
  await context.route(endpoint, async (route) => {
    if (++attempts > 40) {
      await route.abort();
      return;
    }
    await route.continue();
  });
  context.on('requestfailed', (request) => {
    if (request.url() === endpoint) {
      const reason = request.failure()?.errorText;
      report.observations.push({ step, networkFailure: reason });
      console.log(JSON.stringify({ step, networkFailure: reason }));
    }
  });
  context.on('response', (response) => {
    if (response.url() !== endpoint) return;
    const entry = { step, status: response.status() };
    const promise = (async () => {
      try {
        const body = await response.json();
        entry.model = typeof body.model === 'string' ? body.model : undefined;
        entry.inputTokens = body.usage?.input_tokens || 0;
        entry.outputTokens = body.usage?.output_tokens || 0;
        entry.cost = typeof body.usage?.cost === 'number' ? body.usage.cost : undefined;
        const timing = response.request().timing();
        entry.latencyMs = Math.round(
          timing.responseEnd >= 0 ? timing.responseEnd : timing.responseStart,
        );
        entry.answerCount = Object.keys(body.answers || {}).length;
        // Deliberately do not retain error bodies, headers, prompts, cookies or credentials.
      } catch {
        entry.unreadableBody = true;
      }
      report.requests.push(entry);
      await save();
    })();
    pending.add(promise);
    void promise.finally(() => pending.delete(promise));
  });
  await worker.evaluate(async (token) => {
    await chrome.storage.local.set({
      settings: {
        connectionVersion: 2,
        provider: 'openrouter',
        connections: {
          jev: { endpoint: 'https://api.typesafe.ai/v1/systemone', token: '', model: 'jev-latest' },
          openrouter: {
            endpoint: 'https://openrouter.ai/api/alpha/decisions',
            token,
            model: 'typesafe/jev-1.13',
          },
          custom: { endpoint: 'http://localhost:8787/v1/evaluate', token: '', model: 'jev-latest' },
        },
        granularity: 'sentence',
        density: 0.2,
        remoteConsent: false,
      },
    });
  }, key);
  const page = await context.newPage();
  await page.goto(base);
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((t) => t.url === url).id,
    page.url(),
  );
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 390, height: 850 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  await worker.evaluate((tabId) => chrome.tabs.update(tabId, { active: true }), tabId);
  const ready = async () => {
    await panel.waitForFunction(
      () =>
        !document.querySelector('.progress') &&
        !!document.querySelector('.footer-meta') &&
        !document.querySelector('.footer-meta')?.textContent?.includes('…'),
      undefined,
      { timeout: 65000 },
    );
    const error = await panel.locator('.notice.error').allTextContents();
    if (error.length) throw new Error(error.join(' '));
  };
  const cards = async () =>
    panel.locator('.highlight-card').evaluateAll((nodes) =>
      nodes.map((el) => ({
        topic: el.querySelector('.topic')?.textContent,
        text: el.querySelector('.card-content p')?.textContent,
        score: el.querySelector('.score')?.textContent,
      })),
    );
  async function find(intent) {
    await panel.getByRole('textbox', { name: 'Intent' }).fill(intent);
    await panel.getByRole('button', { name: 'Find passages', exact: true }).click();
    await panel.locator('.intent-label').waitFor();
    await ready();
    return cards();
  }
  step = 'connection';
  await panel.getByRole('button', { name: 'API settings', exact: true }).click();
  const dialog = panel.getByRole('dialog', { name: 'API settings' });
  await dialog.getByRole('button', { name: 'Test connection', exact: true }).click();
  await panel.waitForFunction(
    () =>
      /Connected|returned|Cannot reach|timed out/.test(
        document.querySelector('.api-result')?.textContent || '',
      ),
    undefined,
    { timeout: 65000 },
  );
  const connectionMessage = await dialog.locator('.api-result').textContent();
  if (!connectionMessage.includes('Connected')) throw new Error(connectionMessage);
  record(step, { passed: true, message: 'Live Score and Choice accepted.' });
  step = 'highlight-sentence';
  await dialog.getByRole('checkbox', { name: /Allow visible page text/ }).check();
  await dialog.getByRole('button', { name: 'Save settings' }).click();
  await ready();
  let results = await cards();
  record(step, { passed: results.length > 0, cards: results });
  await panel.screenshot({ path: join(output, 'see.png') });
  if (!results.length) throw new Error('No important passages on the article fixture.');
  step = 'navigator-chinese';
  results = await find('训练需要多少块 GPU，耗时多久？');
  record(step, {
    passed: results.slice(0, 3).some((r) => /eight GPUs|three days/.test(r.text)),
    intent: '训练需要多少块 GPU，耗时多久？',
    cards: results.slice(0, 5),
  });
  await panel.screenshot({ path: join(output, 'find-chinese.png') });
  await panel.locator('.highlight-card').first().hover();
  await panel.locator('.highlight-card').first().click();
  await page.screenshot({ path: join(output, 'find-page.png') });
  step = 'navigator-installation';
  results = await find('How do I install and run this locally?');
  record(step, {
    passed: results.slice(0, 3).some((r) => /install|npm|server/i.test(r.text)),
    cards: results.slice(0, 5),
  });
  step = 'navigator-no-match';
  results = await find(
    'What is the refund policy and how many days do I have to request a refund?',
  );
  record(step, {
    passed: results.length === 0,
    matches: results.length,
    cards: results.slice(0, 3),
  });
  step = 'restore-cache';
  const before = attempts;
  await panel.getByRole('button', { name: 'Clear intent' }).click();
  await ready();
  record(step, { passed: attempts === before, extraRequests: attempts - before });
  step = 'highlight-paragraph';
  await panel.getByRole('button', { name: 'Paragraph', exact: true }).click();
  await ready();
  record(step, { passed: (await cards()).length > 0, cards: (await cards()).slice(0, 3) });
  step = 'cursor-safe';
  await page.locator('#safe').scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: /Act/ }).click();
  await panel.getByRole('textbox', { name: 'Intent' }).fill('Open the installation guide');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await panel.locator('.proposal').waitFor({ timeout: 65000 });
  let proposal = await panel.locator('.proposal h3').textContent();
  if (!proposal.includes('Open installation guide'))
    throw new Error('Cursor did not identify the safe fixture action.');
  const approved = panel.getByRole('button', { name: 'Approve & click' });
  if (!(await approved.isEnabled())) throw new Error('Safe action unexpectedly disabled.');
  await panel.screenshot({ path: join(output, 'cursor.png') });
  await approved.click();
  await page.locator('#safe').filter({ hasText: 'Guide opened' }).waitFor();
  record(step, { passed: true, proposedAction: proposal, executed: 'Local fixture button only' });
  await panel
    .getByRole('button', { name: 'Stop Cursor' })
    .click()
    .catch(() => {});
  await ready();
  step = 'cursor-sensitive';
  await page.locator('#danger').scrollIntoViewIfNeeded();
  await panel.getByRole('button', { name: /Act/ }).click();
  await panel.getByRole('textbox', { name: 'Intent' }).fill('Delete my account');
  await panel.getByRole('button', { name: 'Suggest action' }).click();
  await panel.locator('.proposal').waitFor({ timeout: 65000 });
  proposal = await panel.locator('.proposal h3').textContent();
  const approve = panel.getByRole('button', { name: 'Approve & click' });
  const blocked = (await approve.count()) === 0 || (await approve.isDisabled());
  record(step, { passed: blocked, proposedAction: proposal, blocked });
  await panel.getByRole('button', { name: 'Stop Cursor' }).click();
  step = 'pdf';
  const bytes = await page.pdf({ format: 'A4' });
  const viewer = await context.newPage();
  await viewer.goto(`chrome-extension://${id}/pdf-viewer.html`);
  await viewer
    .locator('#file')
    .setInputFiles({ name: 'live-fixture.pdf', mimeType: 'application/pdf', buffer: bytes });
  await viewer.locator('#status').filter({ hasText: 'pages ·' }).waitFor({ timeout: 25000 });
  await panel.getByRole('button', { name: 'Allow for this page' }).click();
  await ready();
  results = await find('How many GPUs are required for training?');
  record(step, {
    passed: results.slice(0, 3).some((r) => /eight GPUs/.test(r.text)),
    cards: results.slice(0, 3),
  });
  await viewer.close();
  await ready();
  step = 'mdn-public-docs';
  await page.goto('https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });
  await panel.waitForFunction(
    () => document.querySelector('.page-context h1')?.textContent?.includes('CSS Custom Highlight'),
    undefined,
    { timeout: 15000 },
  );
  await ready();
  results = await find('How do I register a highlight in the CSS highlight registry?');
  record(step, {
    passed: results.slice(0, 5).some((r) => /CSS.highlights|registry|register/i.test(r.text)),
    url: page.url(),
    cards: results.slice(0, 5),
  });
  await panel.screenshot({ path: join(output, 'mdn-find.png') });
} catch (error) {
  const message = redact(error instanceof Error ? error.message : 'Live test failed');
  record(step, { passed: false, error: message });
  process.exitCode = 1;
} finally {
  await Promise.allSettled([...pending]);
  report.totalRequestsAttempted = attempts;
  report.totals = {
    inputTokens: report.requests.reduce((n, r) => n + (r.inputTokens || 0), 0),
    outputTokens: report.requests.reduce((n, r) => n + (r.outputTokens || 0), 0),
    reportedCost: report.requests.reduce((n, r) => n + (r.cost || 0), 0),
  };
  report.finishedAt = new Date().toISOString();
  if (context) {
    await context.close();
    await Promise.allSettled([...pending]);
  }
  if (profile) await rm(profile, { recursive: true, force: true });
  if (server) await new Promise((r) => server.close(r));
  await mkdir(output, { recursive: true });
  await save();
  console.log(
    JSON.stringify({
      totals: report.totals,
      requests: attempts,
      checks: report.checks.length,
      failed: report.checks.filter((c) => !c.passed).map((c) => c.name),
      credentials: 'Temporary browser profile deleted; key not included in report.',
    }),
  );
  if (report.checks.some((check) => !check.passed)) process.exitCode = 1;
  key = '';
}
