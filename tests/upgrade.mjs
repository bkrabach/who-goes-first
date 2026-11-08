import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
let release = 'one';
const mime = { 'html':'text/html', 'js':'text/javascript', 'css':'text/css', 'webmanifest':'application/manifest+json', 'png':'image/png', 'svg':'image/svg+xml' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/seed') { res.writeHead(200, {'Content-Type':'text/html'}); res.end('<title>Seed unrelated cache</title>'); return; }
    const file = path === '/' ? 'index.html' : path.slice(1);
    if (file.includes('..')) throw new Error('Bad path');
    let body = await readFile(resolve(root, 'dist', file));
    if (file === 'index.html') body = body.toString().replace('<title>Who Goes First?</title>', `<title>Release ${release}</title>`);
    if (file === 'app.js') body = body.toString() + `\nwindow.testRelease = '${release}';`;
    if (file === 'sw.js') body = body.toString().replace(/const CACHE = PREFIX \+ '[^']+';/, `const CACHE = PREFIX + '${release}';`);
    res.writeHead(200, { 'Content-Type':mime[file.split('.').at(-1)] || 'text/plain', 'Cache-Control':file === 'sw.js' ? 'no-store' : 'public,max-age=86400' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true});
const checks = [];
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/seed`);
  await page.evaluate(async base => {
    const cache = await caches.open('another-app-poison-cache');
    await cache.put(`${base}/index.html`, new Response('<title>Poison</title>', {headers:{'Content-Type':'text/html'}}));
    await cache.put(`${base}/app.js`, new Response('throw new Error("wrong cache")', {headers:{'Content-Type':'text/javascript'}}));
  }, base);
  await page.goto(base);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
  });
  await page.reload();
  assert.equal(await page.title(), 'Release one');
  assert.equal(await page.evaluate(() => window.testRelease), 'one');
  checks.push('worker ignores poisoned assets in another origin cache');
  release = 'two';
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
    if (!registration.waiting) await new Promise(resolve => {
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', () => { if (worker.state === 'installed') resolve(); });
      else registration.addEventListener('updatefound', () => registration.installing.addEventListener('statechange', () => {if (registration.waiting) resolve();}));
    });
  });
  assert.equal(await page.evaluate(() => window.testRelease), 'one');
  checks.push('updated worker waits without interrupting an open game');
  // Navigate to an uncontrolled blank page to let the waiting worker activate.
  await page.goto('about:blank');
  const inspection = await context.newPage();
  await inspection.goto(`${base}/seed`);
  await inspection.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration.active?.state !== 'activated' || registration.waiting) {
      await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, {once:true}));
    }
  });
  await inspection.goto(base);
  assert.equal(await inspection.title(), 'Release two');
  assert.equal(await inspection.evaluate(() => window.testRelease), 'two');
  checks.push('new HTML and JS replace HTTP-cached assets together after old tabs close');
  await context.setOffline(true);
  await inspection.reload();
  assert.equal(await inspection.title(), 'Release two');
  assert.equal(await inspection.evaluate(() => window.testRelease), 'two');
  const keys = await inspection.evaluate(() => caches.keys());
  assert.ok(keys.includes('another-app-poison-cache'));
  assert.ok(keys.some(key => key.endsWith(':two')));
  assert.ok(!keys.some(key => key.endsWith(':one')));
  checks.push('new release reloads offline; cleanup preserves other apps’ caches');
  for (const check of checks) console.log(`PASS ${check}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await mkdir(resolve(root, 'test-results'), {recursive:true});
  await writeFile(resolve(root, 'test-results/upgrade-results.json'), JSON.stringify({checks},null,2) + '\n');
}