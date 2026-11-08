import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'test-results');
await mkdir(out, { recursive: true });
const server = createStaticServer(resolve(root, 'dist'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const checks = [];
const pass = check => { checks.push(check); console.log(`PASS ${check}`); };
try {
  const context = await browser.newContext({ viewport: { width: 640, height: 1016 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(base);
  // Centering can place the artwork on a fractional device pixel; align this
  // exact raster comparison to a whole pixel without changing its proportions.
  await page.locator('body').evaluate(node => {node.style.alignContent = 'start';});
  await page.waitForFunction(() => document.querySelectorAll('.reel-name').length === 5);
  await page.locator('.original-screen').screenshot({ path: resolve(out, 'original-restored-main.png') });
  const screen = await page.locator('.original-screen').boundingBox();
  assert.equal(screen.width, 640);
  assert.equal(screen.height, 920);
  const geometry = await page.evaluate(() => {
    const stage = document.querySelector('.original-screen').getBoundingClientRect();
    const box = selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x:r.x - stage.x, y:r.y - stage.y, width:r.width, height:r.height };
    };
    return {players:box('#manage-top'),spin:box('#spin-button'),reel:box('.reel-shell'),name:box('.selected')};
  });
  assert.ok(Math.abs(geometry.players.x - 396) < 1 && Math.abs(geometry.players.y - 11) < 1);
  assert.ok(Math.abs(geometry.spin.x - 54) < 1 && Math.abs(geometry.spin.y - 672) < 1);
  assert.ok(Math.abs(geometry.reel.x - 49) < 1 && Math.abs(geometry.reel.y - 158) < 1);
  assert.ok(Math.abs(geometry.name.y + geometry.name.height / 2 - 363) < 1);
  pass('640×920 composition and live overlays match the reference coordinates');
  await page.locator('#reel-track').evaluate(node => {node.style.visibility = 'hidden';});
  await page.locator('#settings-open').evaluate(node => {node.style.visibility = 'hidden';});
  const machineBox = await page.locator('.machine').boundingBox();
  await page.screenshot({ path: resolve(out, 'original-clean-artwork.png'),clip:{x:Math.round(machineBox.x),y:Math.round(machineBox.y),width:585,height:532} });
  await page.locator('#reel-track').evaluate(node => {node.style.visibility = '';});
  await page.locator('#settings-open').evaluate(node => {node.style.visibility = '';});
  const image = await readFile(resolve(root, 'assets/machine-frame.png'));
  const pixels = await readFile(resolve(out, 'original-clean-artwork.png'));
  const exact = await page.evaluate(async data => {
    const load = async src => {
      const img = new Image();
      img.src = `data:image/png;base64,${src}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img,0,0);
      return c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    };
    const a = await load(data.a), b = await load(data.b);
    let different = 0;
    for (let i=0; i<a.length; i++) if (a[Math.floor(i/4)*4+3]===255 && a[i] !== b[i]) different++;
    return {different,length:a.length};
  }, {a:image.toString('base64'), b:pixels.toString('base64')});
  assert.equal(exact.different, 0);
  pass('opaque original machine artwork is pixel-identical; transparent corners reveal the continuous backing');
  await page.emulateMedia({ reducedMotion:'no-preference' });
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => document.querySelector('#reel-track').getAnimations().length === 1);
  await page.locator('#reel-track').evaluate(track => {
    const animation = track.getAnimations()[0];
    if (animation.effect.getKeyframes().length !== 161 || animation.effect.getTiming().easing !== 'linear') throw new Error('Expected the coast-and-settle motion profile');
    animation.pause();
    animation.currentTime = 600;
  });
  await page.locator('.original-screen').screenshot({ path:resolve(out,'original-spinning.png') });
  const fractionBefore = await page.locator('#reel-track').evaluate(track => {
    return new DOMMatrix(getComputedStyle(track).transform).m42 / track.getBoundingClientRect().height;
  });
  await page.setViewportSize({width:390,height:844});
  const fractionAfter = await page.locator('#reel-track').evaluate(track => {
    return new DOMMatrix(getComputedStyle(track).transform).m42 / track.getBoundingClientRect().height;
  });
  assert.ok(Math.abs(fractionBefore - fractionAfter) < .0001);
  const namesVisible = await page.locator('#reel-track').evaluate(track => {
    const frame = document.querySelector('#reel-window').getBoundingClientRect();
    return [...track.children].some(node => {
      const box = node.getBoundingClientRect();
      return box.top < frame.top + frame.height / 2 && box.bottom > frame.top + frame.height / 2;
    });
  });
  assert.ok(namesVisible);
  pass('mid-spin resize preserves the current fractional row and never blanks the selection window');
  await page.locator('#reel-track').evaluate(track => {
    const animation = track.getAnimations()[0];
    animation.finish();
  });
  await page.waitForFunction(() => document.querySelector('#result').textContent.endsWith('goes first!'));
  const nameCenter = await page.evaluate(() => {
    const window = document.querySelector('.reel-shell').getBoundingClientRect();
    const selected = document.querySelector('.selected').getBoundingClientRect();
    const scale = document.querySelector('.original-screen').getBoundingClientRect().width / 640;
    return (selected.y + selected.height / 2 - window.y) / scale;
  });
  assert.ok(Math.abs(nameCenter - 205) < 1);
  pass('animated reel settles at the fixed selection line after a viewport resize');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.original-screen').screenshot({ path:resolve(out,'original-phone.png') });
  for (const [width,height] of [[320,568],[390,844],[844,390],[1440,900]]) {
    await page.setViewportSize({width,height});
    const bounds = await page.locator('.original-screen').boundingBox();
    assert.ok(Math.abs(bounds.width / bounds.height - 640/920) < .001);
    const machine=await page.locator('.machine').boundingBox();
    assert.ok(Math.abs(machine.width/machine.height-585/532)<.001);
    assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= width);
    if(height>=568)assert.ok(bounds.y + bounds.height <= height);
    assert.ok(await page.locator('#spin-button').isVisible());
  }
  pass('every viewport keeps the original vertical composition; short screens scroll without stretching');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.reel-name').length === 5);
  const loaded = await page.evaluate(async () => {
    const url = getComputedStyle(document.querySelector('.machine')).backgroundImage.match(/url\("(.+)"\)/)[1];
    const img = new Image();
    img.src = url;
    await img.decode();
    return img.naturalWidth;
  });
  assert.equal(loaded,585);
  pass('original artwork remains available after a real offline reload');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(out,'artwork-results.json'),JSON.stringify({checks},null,2)+'\n');
}