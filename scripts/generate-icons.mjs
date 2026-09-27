// Rasterize the project's own SVG into Chrome's required PNG assets.
import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
const svg = await readFile('docs/icon.svg', 'utf8');
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await mkdir('public/icons', { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    const inset = size === 128 ? 16 : 0;
    await page.setContent(
      `<style>body{margin:0;padding:${inset}px}svg{display:block;width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({ path: `public/icons/${size}.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
