import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { slides, scenarios } from '../docs/jevhackathon/story.js';
import { examples } from '../docs/examples-data.js';
assert.equal(
  slides.reduce((sum, slide) => sum + slide.duration, 0),
  180,
);
assert.equal(new Set(scenarios.map((scene) => scene.category)).size, 5);
for (const scene of scenarios) assert(examples.some((example) => example.id === scene.id));
const browser = await chromium.launch({ channel: 'chromium', headless: true });
await mkdir('qa-results/slides', { recursive: true });
try {
  for (const [width, height] of [
    [1440, 900],
    [1366, 768],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [375, 667],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    const external = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4174/')) external.push(request.url());
    });
    await page.clock.install();
    await page.goto('http://127.0.0.1:4174/jevhackathon/');
    await page.locator('#stage[data-slide="1"]').waitFor();
    await page.clock.fastForward(16000);
    assert.equal(
      await page.locator('#stage').getAttribute('data-slide'),
      '1',
      'Must stay on the page when its animation ends',
    );
    assert.equal(await page.locator('#play').textContent(), '重播 ↻');
    await page.getByRole('button', { name: '重播本页' }).click();
    await page.clock.fastForward(1000);
    assert.match(await page.locator('#time').textContent(), /^00:01/);
    await page.getByRole('button', { name: '暂停演示' }).click();
    const paused = await page.locator('#time').textContent();
    await page.clock.fastForward(2000);
    assert.equal(await page.locator('#time').textContent(), paused);
    for (let i = 0; i < slides.length; i++) {
      if (i) await page.getByRole('button', { name: '下一页', exact: true }).click();
      assert.equal(await page.locator('#stage').getAttribute('data-slide'), String(i + 1));
      if (i)
        assert.equal(
          await page.locator('#seek').inputValue(),
          '0',
          'Entering a slide must restart its animation',
        );
      if (slides[i].kind === 'demo') {
        await page.clock.fastForward(7000);
        const query = await page.locator('.query-text').textContent();
        assert(
          query.length > 0 && query.length <= slides[i].scene.question.length,
          'Command should type itself',
        );
        assert.equal(await page.locator('#stage').getAttribute('data-phase'), '1');
        await page.clock.fastForward(6000);
        assert.equal(await page.locator('#stage').getAttribute('data-phase'), '2');
        const resultVisible = await page.locator('.result').evaluate((el) => {
          const r = el.getBoundingClientRect();
          const parent = el.closest('.demo-lens').getBoundingClientRect();
          return r.top >= parent.top && r.bottom <= parent.bottom;
        });
        assert(resultVisible, `Result clipped before confirmation at ${width}x${height}`);
      }
      await page.clock.fastForward(25000);
      assert.equal(
        await page.locator('#stage').getAttribute('data-slide'),
        String(i + 1),
        'Animations must never turn the page',
      );
      const layout = await page.evaluate(() => {
        const selectors = [
          '.masthead',
          '#stage',
          '.narration',
          '.player',
          '#previous',
          '#next',
          '#slide-title',
          '.arrival',
        ];
        return {
          width: document.documentElement.scrollWidth,
          height: document.documentElement.scrollHeight,
          clipped: selectors.flatMap((selector) => {
            const el = document.querySelector(selector);
            if (!el) return [];
            const r = el.getBoundingClientRect();
            const parent =
              selector === '.arrival'
                ? el.closest('.demo-lens').getBoundingClientRect()
                : { top: 0, left: 0, right: innerWidth, bottom: innerHeight };
            return r.top < parent.top - 1 ||
              r.left < parent.left - 1 ||
              r.right > parent.right + 1 ||
              r.bottom > parent.bottom + 1
              ? [selector]
              : [];
          }),
        };
      });
      assert(
        layout.width <= width && layout.height <= height,
        `Overflow on slide ${i + 1} at ${width}x${height}`,
      );
      assert.deepEqual(
        layout.clipped,
        [],
        `Clipped content on slide ${i + 1} at ${width}x${height}`,
      );
      await page.screenshot({
        path: `qa-results/slides/${width}x${height}-${i + 1}.png`,
        animations: 'disabled',
      });
    }
    await page.getByRole('button', { name: '上一页', exact: true }).click();
    assert.equal(await page.locator('#seek').inputValue(), '0');
    await page.clock.fastForward(1000);
    await page.locator('#stage').hover();
    await page.mouse.wheel(0, -140);
    await page.waitForFunction(() => document.querySelector('#stage').dataset.slide === '7');
    await page.locator('#stage').click({ position: { x: 8, y: 8 } });
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.locator('#stage').getAttribute('data-slide'), '6');
    await page.locator('#stage').evaluate((el) => {
      el.dispatchEvent(
        new TouchEvent('touchstart', {
          touches: [new Touch({ identifier: 1, target: el, clientX: 200, clientY: 350 })],
        }),
      );
      el.dispatchEvent(
        new TouchEvent('touchend', {
          changedTouches: [new Touch({ identifier: 1, target: el, clientX: 200, clientY: 150 })],
        }),
      );
    });
    assert.equal(
      await page.locator('#stage').getAttribute('data-slide'),
      '7',
      'Swipe should advance one slide',
    );
    await page.goto('http://127.0.0.1:4174/jevhackathon/#slide-4');
    await page.locator('#stage[data-slide="4"]').waitFor();
    assert.equal(await page.locator('#seek').inputValue(), '0');
    assert.deepEqual(errors, []);
    assert.deepEqual(external, [], 'Presentation should make no API or third-party requests');
    await page.close();
    console.log(
      `PASS ${width}x${height}: 9 slides, autoplay within page, manual navigation, replay/pause, 5 demos, no network dependencies`,
    );
  }
} finally {
  await browser.close();
}
