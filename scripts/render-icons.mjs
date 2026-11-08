// Development only: use an installed Playwright (or playwright-core) package.
// App users and static hosts need no Node or browser-automation dependency.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName);
const root = fileURLToPath(new URL('../', import.meta.url));
const svg = await readFile(resolve(root, 'icons/icon.svg'), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['icon-maskable.png', 512], ['apple-touch-icon.png', 180]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%;background:#edbe51}svg{width:100%;height:100%}</style>${svg}`);
    await page.screenshot({ path: resolve(root, 'icons', file) });
    console.log(`${file}: ${size}×${size}`);
  }
} finally { await browser.close(); }