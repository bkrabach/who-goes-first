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
  await context.setOffline(false);
  await inspection.evaluate(()=>{
    localStorage.setItem('who-goes-first:players:v1',JSON.stringify({version:1,players:[
      {id:'keep-a',name:'Keep Alice',active:true},{id:'keep-b',name:'Keep Bob',active:true}
    ]}));
    localStorage.setItem('who-goes-first:settings:v1',JSON.stringify({version:1,settings:{sound:true,volume:40,motion:'system'}}));
  });
  await inspection.reload();
  const saved=await inspection.evaluate(()=>({players:localStorage.getItem('who-goes-first:players:v1'),settings:localStorage.getItem('who-goes-first:settings:v1')}));
  const other=await context.newPage();await other.goto(base);
  await inspection.locator('#spin-button').click();
  await inspection.locator('#reel-track').evaluate(track=>track.getAnimations()[0].pause());
  release='three';
  await inspection.evaluate(async()=>{
    const registration=await navigator.serviceWorker.getRegistration();
    await registration.update();
    if(!registration.waiting)await new Promise(resolve=>{
      const worker=registration.installing;
      worker.addEventListener('statechange',()=>{if(worker.state==='installed')resolve();});
    });
  });
  await inspection.waitForFunction(()=>!document.querySelector('#apply-update').hidden);
  assert.ok(await inspection.locator('#apply-update').isDisabled());
  await inspection.locator('#apply-update').dispatchEvent('click');
  assert.equal(await inspection.evaluate(()=>window.testRelease),'two');
  assert.equal(await inspection.locator('#reel-track').evaluate(track=>track.getAnimations()[0].playState),'paused');
  await inspection.locator('#reel-track').evaluate(track=>track.getAnimations()[0].finish());
  await inspection.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  checks.push('waiting update cannot apply during a spin or interrupt its landing');
  await inspection.locator('#settings-open').click();
  await inspection.locator('#apply-update').click();
  await inspection.waitForFunction(()=>document.querySelector('#update-status').textContent.includes('Close other'));
  assert.match(await inspection.locator('#update-status').textContent(),/Update paused — 1 other window or tab is/);
  assert.equal(await inspection.locator('#apply-update').textContent(),'Retry update');
  assert.ok(await inspection.locator('#update-status').evaluate(node=>node.classList.contains('update-attention')));
  assert.equal(await inspection.evaluate(()=>window.testRelease),'two');
  assert.equal(await other.evaluate(()=>window.testRelease),'two');
  assert.equal(await inspection.locator('#spin-button').isDisabled(),false);
  await other.close();
  const navigation=inspection.waitForNavigation();
  await inspection.locator('#apply-update').click();
  await navigation;
  await inspection.waitForFunction(()=>window.testRelease==='three');
  assert.equal(await inspection.title(),'Release three');
  assert.deepEqual(await inspection.evaluate(()=>({players:localStorage.getItem('who-goes-first:players:v1'),settings:localStorage.getItem('who-goes-first:settings:v1')})),saved);
  await inspection.setViewportSize({width:1920,height:1080});
  const geometry=await inspection.evaluate(()=>{
    const r=document.querySelector('.original-screen').getBoundingClientRect();
    return {ratio:r.width/r.height,width:r.width};
  });
  assert.ok(Math.abs(geometry.ratio-640/920)<.001&&geometry.width<=640);
  await context.setOffline(true);await inspection.reload();
  assert.equal(await inspection.evaluate(()=>window.testRelease),'three');
  checks.push('explicit update refuses other app windows, then reloads safely with saved data and vertical layout intact');
  await context.setOffline(false);
  for(const scenario of ['stale','timeout','accepted-timeout','controller']){
    const mocked=await browser.newContext();
    await mocked.addInitScript(scenario=>{
      const registration=new EventTarget();
      registration.waiting={postMessage(_message,ports){
        if(scenario==='accepted-timeout')ports[0].postMessage({status:'accepted'});
      }};
      registration.update=()=>Promise.resolve();
      window.updateTestRegistration=registration;
      window.updateTestController={old:true};
      Object.defineProperty(navigator.serviceWorker,'controller',{get:()=>window.updateTestController});
      navigator.serviceWorker.register=()=>Promise.resolve(registration);
      Object.defineProperty(navigator.serviceWorker,'ready',{get:()=>Promise.resolve(registration)});
      const timeout=window.setTimeout;
      window.setTimeout=(callback,delay,...args)=>timeout(callback,delay===10000?30:delay,...args);
    },scenario);
    const mp=await mocked.newPage();await mp.goto(base);
    await mp.locator('#settings-open').click();
    await mp.locator('#apply-update').waitFor({state:'visible'});
    if(scenario==='stale'){
      await mp.evaluate(()=>{updateTestRegistration.waiting=null;});
      await mp.locator('#apply-update').click();
      assert.ok(await mp.locator('#apply-update').isHidden());
      assert.match(await mp.locator('#update-status').textContent(),/No update is waiting/);
      assert.equal(await mp.locator('#settings-open').evaluate(node=>node.classList.contains('update-ready')),false);
    }else if(scenario==='controller'){
      await mp.keyboard.press('Escape');await mp.locator('#spin-button').click();
      await mp.locator('#reel-track').evaluate(track=>track.getAnimations()[0].pause());
      await mp.evaluate(()=>{
        updateTestRegistration.waiting=null;updateTestController={new:true};
        navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
      });
      assert.equal(await mp.locator('#apply-update').textContent(),'Reload updated app');
      assert.ok(await mp.locator('#apply-update').isDisabled());
      assert.equal(await mp.locator('#reel-track').evaluate(track=>track.getAnimations()[0].playState),'paused');
      await mp.locator('#reel-track').evaluate(track=>track.getAnimations()[0].finish());
      await mp.waitForFunction(()=>!document.querySelector('#apply-update').disabled);
    }else{
      await mp.locator('#apply-update').click();
      await mp.waitForFunction(()=>document.querySelector('#apply-update').textContent==='Reopen app to finish');
      assert.ok(await mp.locator('#apply-update').isDisabled());
      assert.ok(await mp.locator('#spin-button').isDisabled());
      assert.match(await mp.locator('#update-status').textContent(),/Your saved players and settings will stay/);
    }
    await mocked.close();
  }
  checks.push('stale update UI clears; controller changes never interrupt a spin; uncertain activation keeps an explicit safe-reopen state');
  for (const check of checks) console.log(`PASS ${check}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await mkdir(resolve(root, 'test-results'), {recursive:true});
  await writeFile(resolve(root, 'test-results/upgrade-results.json'), JSON.stringify({checks},null,2) + '\n');
}