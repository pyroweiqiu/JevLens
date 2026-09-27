import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
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
    await page.keyboard.press('Escape');
    if (await page.getByRole('dialog').isVisible()) throw new Error('Install guide did not close');
    console.log(
      `PASS ${width}x${height}: one screen, See/Find/Act, approval, keyboard, installation`,
    );
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
