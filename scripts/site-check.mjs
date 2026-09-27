import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { examples } from '../docs/examples-data.js';
const matrix = JSON.parse(await readFile('tests/fixtures/regression-matrix.json', 'utf8'));
if (
  examples.length !== matrix.length ||
  !examples.every(
    (e, i) => e.id === matrix[i].id && e.url === matrix[i].url && e.keyword && e.question,
  )
)
  throw new Error('Public recipes do not match the source scenario matrix');
let available = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    if ((await fetch('http://127.0.0.1:4174')).ok) {
      available = true;
      break;
    }
  } catch {
    /* Wait for the local preview server. */
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!available) throw new Error('Start npm run site:preview before checking the showcase.');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
await mkdir('qa-results/site', { recursive: true });
try {
  const page = await browser.newPage();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [375, 667],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto('http://127.0.0.1:4174');
    const size = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    if (size.width > width || size.height > height)
      throw new Error(`Page overflow at ${width}x${height}: ${JSON.stringify(size)}`);
    await page.getByRole('tab', { name: /Find/ }).click();
    if (!(await page.locator('#find-content').isVisible()))
      throw new Error('Find did not activate');
    await page.getByRole('tab', { name: /Act/ }).click();
    if (await page.locator('#article-appendix').isVisible())
      throw new Error('Act navigated before approval');
    const buttonInside = await page.locator('#approve').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const p = el.closest('.browser-body').getBoundingClientRect();
      return r.top >= p.top && r.bottom <= p.bottom;
    });
    if (!buttonInside) throw new Error(`Approve button clipped at ${width}x${height}`);
    await page.locator('#approve').click();
    if (!(await page.locator('#article-appendix').isVisible()))
      throw new Error('Approve did not navigate');
    await page.getByRole('tab', { name: /See/ }).click();
    await page.screenshot({
      animations: 'disabled',
      path: `qa-results/site/${width}x${height}.png`,
    });
    await page.getByRole('tab', { name: /See/ }).focus();
    await page.keyboard.press('ArrowRight');
    if ((await page.locator('#tab-find').getAttribute('aria-selected')) !== 'true')
      throw new Error('Keyboard tab navigation failed');
    await page.locator('#install').click();
    if (!(await page.getByRole('dialog').isVisible()))
      throw new Error('Install guide did not open');
    if (width === 1440) {
      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByRole('link', { name: /下载 JevLens/ }).click(),
      ]);
      const filename = download.suggestedFilename();
      const expected = (await readFile(`docs/downloads/${filename}.sha256`, 'utf8')).split(' ')[0];
      const actual = createHash('sha256')
        .update(await readFile(await download.path()))
        .digest('hex');
      if (actual !== expected) throw new Error('Downloaded ZIP checksum mismatch');
      console.log('PASS direct extension download and SHA-256 checksum');
    }
    await page.keyboard.press('Escape');
    if (await page.getByRole('dialog').isVisible()) throw new Error('Install guide did not close');
    console.log(
      `PASS ${width}x${height}: one screen, See/Find/Act, approval, keyboard, installation`,
    );
    await page.getByRole('link', { name: 'Examples', exact: true }).click();
    await page.locator('.example-item').first().waitFor();
    if ((await page.locator('.example-item').count()) !== 120)
      throw new Error('Expected all 120 scenario entries');
    await page.screenshot({ path: `qa-results/site/examples-${width}x${height}.png` });
    await page.getByLabel('搜索案例').fill('HighlightRegistry');
    if ((await page.locator('.example-item').count()) !== 1)
      throw new Error('Keyword search did not narrow examples');
    await page.locator('.example-item').click();
    await page.getByRole('heading', { name: 'MDN · CSS 高亮 API' }).waitFor();
    await page.getByRole('button', { name: '复制关键词', exact: true }).click();
    if ((await page.evaluate(() => navigator.clipboard.readText())) !== 'HighlightRegistry')
      throw new Error('Keyword copy failed');
    await page.locator('#share-case').click();
    if (
      !(await page.evaluate(() => navigator.clipboard.readText())).endsWith('examples.html#case-95')
    )
      throw new Error('Share link should identify the selected example');
    if (width <= 760) await page.getByRole('button', { name: '返回案例列表' }).click();
    await page.getByLabel('搜索案例').fill('no-such-example-987654');
    if (!(await page.locator('#empty-results').isVisible())) throw new Error('Missing empty state');
    await page.locator('#reset-filters').click();
    await page.getByLabel('验证状态', { exact: true }).selectOption('extraction');
    if ((await page.locator('.example-item').count()) !== 7)
      throw new Error('Incorrect verification filter');
    await page.getByLabel('验证状态', { exact: true }).selectOption('all');
    await page.getByLabel('场景分类').selectOption('pdf');
    if ((await page.locator('.example-item').count()) !== 8)
      throw new Error('Incorrect PDF topic filter');
    await page.goto('http://127.0.0.1:4174/examples.html#case-4');
    await page.getByRole('heading', { name: 'Attention Is All You Need · PDF' }).waitFor();
    if (!(await page.getByRole('button', { name: '复制页码指令' }).count()))
      throw new Error('PDF navigation recipe is missing');
    await page.screenshot({ path: `qa-results/site/example-detail-${width}x${height}.png` });
    await page.goto('http://127.0.0.1:4174/examples.html#case-115');
    await page.getByRole('heading', { name: 'Google Docs · 编辑器边界' }).waitFor();
    if (await page.getByRole('link', { name: '打开原页面' }).count())
      throw new Error('Wildcard templates must not be presented as working page links');
    await page.getByRole('link', { name: 'Docs', exact: true }).click();
    await page
      .getByRole('navigation', { name: '文档目录' })
      .getByRole('link', { name: /PDF 与目录/ })
      .click();
    const sectionVisible = await page.locator('#pdf').evaluate((el) => {
      const r = el.getBoundingClientRect();
      const p = el.closest('article').getBoundingClientRect();
      return r.top >= p.top && r.top < p.bottom;
    });
    if (!sectionVisible) throw new Error('Docs table of contents did not scroll to PDF guide');
    await page.screenshot({ path: `qa-results/site/docs-${width}x${height}.png` });
    const librarySize = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));
    if (librarySize.width > width || librarySize.height > height)
      throw new Error(`Docs overflow at ${width}x${height}`);
    console.log(
      `PASS ${width}x${height}: 120 examples, filters, copying, deep links, boundary cases, Docs navigation`,
    );
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
