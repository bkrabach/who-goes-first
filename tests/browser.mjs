import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';

// Point PLAYWRIGHT_MODULE at an existing Playwright/Playwright-core installation.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const server = process.env.TEST_URL ? null : createStaticServer(resolve(root, 'dist'));
if (server) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = process.env.TEST_URL || `http://127.0.0.1:${server.address().port}`;
const out = resolve(root, 'test-results');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const checks = [];
const errors = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
const key = 'who-goes-first:players:v1';
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#top-count').textContent === '6');
  assert.equal(await page.locator('#table-list li').count(), 6);
  await page.screenshot({ path: resolve(out, 'desktop.png'), fullPage: true });
  pass('fresh browser shows the six enabled original players');
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  const name = (await page.locator('#result').textContent()).replace(' goes first!', '');
  assert.equal(await page.locator('.reel-name.selected').textContent(), name);
  pass('spin announces a winner and settles the reel on that same player');
  await page.locator('#manage-top').click();
  assert.equal(await page.locator('#players-list [role=switch]').count(), 9);
  await page.getByRole('switch', { name: 'Kevin Flynn is playing' }).click();
  assert.equal(await page.getByRole('switch', { name: 'Kevin Flynn is playing' }).getAttribute('aria-checked'), 'false');
  await page.locator('#new-name').fill('  Zoë   王  ');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  assert.equal(await page.locator('#players-list input').last().inputValue(), 'Zoë 王');
  const rename = page.getByRole('textbox', { name: 'Name for Zoë 王', exact: true });
  await rename.fill('River Song');
  await rename.press('Enter');
  await page.getByRole('button', { name: 'Remove River Song', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Name for River Song', exact: true }).inputValue(), 'River Song');
  await page.screenshot({ path: resolve(out, 'players-desktop.png'), fullPage: true });
  pass('toggle, add, Unicode names, rename, remove, and modal Undo work');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await page.locator('#manage-top').click();
  assert.equal(await page.getByRole('switch', { name: 'Kevin Flynn is playing' }).getAttribute('aria-checked'), 'false');
  assert.equal(await page.getByRole('textbox', { name: 'Name for River Song', exact: true }).inputValue(), 'River Song');
  pass('player edits and participation survive reload');
  await page.locator('#select-none').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.ok(await page.locator('#spin-button').isDisabled());
  assert.equal(await page.locator('.reel-name.selected').textContent(), 'Everyone’s invited.');
  await page.locator('#manage-top').click();
  await page.getByRole('switch', { name: 'River Song is playing' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => document.querySelector('#result').textContent === 'River Song goes first!');
  pass('zero-player state blocks spin; solo player is selected without suspense');
  await page.locator('#manage-top').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#players-dialog').evaluate(node => node.open), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), 'manage-top');
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#players-dialog').evaluate(node => node.open), true);
  await page.keyboard.press('Escape');
  pass('keyboard opens/closes the native modal and restores focus');

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once:true }));
  });
  await context.setOffline(true);
  await page.reload();
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => document.querySelector('#result').textContent === 'River Song goes first!');
  pass('real service worker reloads offline with saved data and working selection');
  await context.setOffline(false);

  await page.evaluate(key => localStorage.removeItem(key), key);
  await page.reload();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('#manage-top').click();
  await page.getByRole('button', {name:'Remove Mazer Rackham', exact:true}).click();
  await page.keyboard.press('Escape');
  await page.locator('#spin-button').click();
  assert.ok(await page.locator('#spin-button').isDisabled());
  assert.ok(await page.locator('#manage-top').isDisabled());
  assert.ok(await page.locator('#undo-delete').isDisabled());
  const rosterBefore = await page.evaluate(key => localStorage.getItem(key), key);
  await page.locator('#undo-delete').evaluate(button => button.dispatchEvent(new MouseEvent('click', {bubbles:true})));
  assert.equal(await page.evaluate(key => localStorage.getItem(key), key), rosterBefore);
  await page.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  await page.getByRole('button', {name:'Undo', exact:true}).click();
  await page.locator('#manage-top').click();
  assert.equal(await page.locator('#players-list [role=switch]').count(), 9);
  await page.keyboard.press('Escape');
  pass('normal animation completes and locks overlapping spins, edits, and deletion Undo');
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    await page.locator('#manage-top').click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No modal horizontal overflow at ${width}px`);
    if (width === 390) await page.screenshot({ path: resolve(out, 'players-mobile.png'), fullPage: true });
    await page.keyboard.press('Escape');
    if (width === 390) await page.screenshot({ path: resolve(out, 'mobile.png'), fullPage: true });
  }
  pass('main and player views fit 320, 390, 768, and 1024px viewports');

  await page.evaluate(key => localStorage.setItem(key, JSON.stringify({version:1, players:[]})), key);
  await page.reload();
  assert.ok(await page.locator('#spin-button').isDisabled());
  await page.locator('#manage-top').click();
  assert.equal(await page.locator('#players-list .player-row').count(), 0);
  pass('an intentionally empty saved list stays empty after reload');
  await page.keyboard.press('Escape');
  await page.evaluate(key => localStorage.setItem(key, '{broken'), key);
  await page.reload();
  assert.equal(await page.locator('#table-list li').count(), 6);
  assert.match(await page.locator('#saved-note').textContent(), /could not be loaded/);
  assert.ok(await page.locator('#storage-warning').isVisible());
  assert.match(await page.locator('#storage-warning').textContent(), /could not be loaded/);
  pass('corrupt storage recovers to demo data with an explicit warning');

  await page.locator('#manage-top').click();
  await page.locator('#new-name').fill('<img src=x onerror=alert(1)>');
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  assert.equal(await page.locator('#table-list img').count(), 0);
  await page.locator('#select-none').click();
  await page.getByRole('switch', { name: '<img src=x onerror=alert(1)> is playing', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  assert.equal(await page.locator('#reel-track img').count(), 0);
  pass('player names are rendered as text, never HTML');

  const manifest = await (await page.request.get(`${base}/manifest.webmanifest`)).json();
  for (const icon of manifest.icons) {
    const response = await page.request.get(new URL(icon.src, `${base}/`).href);
    assert.equal(response.status(), 200);
    assert.equal(response.headers()['content-type'], 'image/png');
    assert.ok((await response.body()).length > 100);
  }
  const cdp = await context.newCDPSession(page);
  const installErrors = await cdp.send('Page.getInstallabilityErrors');
  assert.deepEqual(installErrors.installabilityErrors, []);
  pass('manifest and PNG icons load; Chromium reports no installability errors');

  const blockedStorage = await browser.newContext({ reducedMotion:'reduce' });
  await blockedStorage.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Blocked','QuotaExceededError'); };
  });
  const blockedPage = await blockedStorage.newPage();
  blockedPage.on('pageerror', error => errors.push(error.message));
  await blockedPage.goto(base);
  await blockedPage.locator('#manage-top').click();
  await blockedPage.getByRole('switch', { name:'Kevin Flynn is playing' }).click();
  assert.match(await blockedPage.locator('#saved-note').textContent(), /storage is unavailable/);
  await blockedPage.keyboard.press('Escape');
  await blockedPage.locator('#spin-button').click();
  await blockedPage.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  pass('denied browser storage shows a warning but does not block play');
  await blockedStorage.close();
  const preview = await context.newPage();
  await preview.goto(`file://${resolve(out, 'preview.html')}`);
  await preview.locator('#spin-button').click();
  await preview.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  await preview.locator('#manage-top').click();
  await preview.locator('#new-name').fill('Preview Guest');
  await preview.getByRole('button', {name:'Add player',exact:true}).click();
  assert.equal(await preview.getByRole('textbox', {name:'Name for Preview Guest',exact:true}).inputValue(), 'Preview Guest');
  await preview.close();
  pass('single-file interactive preview uses the real picker and editor successfully');
  assert.deepEqual(errors, []);
  pass('no uncaught browser errors');
  await context.close();
} finally {
  await writeFile(resolve(out, 'browser-results.json'), JSON.stringify({ checks, errors }, null, 2) + '\n');
  await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
}