import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
import {savedCrew} from './crew-fixture.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),key='who-goes-first:players:v1';
const server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const checks=[],errors=[];
const pass=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
  const context=await browser.newContext({reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('.selected').waitFor();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);
  await page.locator('#spin-button').click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);
  await page.locator('#manage-top').click();
  assert.equal(await page.locator('#players-list .player-row').count(),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'new-name');
  assert.equal(await page.locator('#roster-count').textContent(),'0 in · 0 saved');
  assert.ok(await page.locator('#select-all').isDisabled());
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),null);
  pass('fresh browser samples can spin but never persist, and Players opens empty with name entry focused');

  await page.locator('#manage-top').click();await page.locator('#new-name').fill('My First Player');
  await page.getByRole('button',{name:'Add player',exact:true}).click();
  assert.equal(await page.locator('#players-list .player-row').count(),1);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('.selected').textContent(),'My First Player');
  await page.reload();assert.equal(await page.locator('.selected').textContent(),'My First Player');
  await page.locator('#manage-top').click();await page.locator('#select-none').click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.ok(await page.locator('#spin-button').isDisabled());
  await page.locator('#manage-top').click();
  await page.getByRole('button',{name:'Remove My First Player',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.ok(await page.locator('#spin-button').isDisabled());
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  assert.equal(await page.locator('.selected').textContent(),'Everyone’s invited.');
  await page.locator('#manage-top').click();await page.locator('#select-all').click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.equal(await page.locator('.selected').textContent(),'My First Player');
  await page.locator('#manage-top').click();
  await page.getByRole('button',{name:'Remove My First Player',exact:true}).click();
  await page.getByRole('button',{name:'Done',exact:true}).click();
  await page.reload();assert.ok(await page.locator('#spin-button').isDisabled());
  pass('adding a real player replaces samples; all-out, deletion, undo, and saved-empty reload never resurrect demos');

  for(const [crew,kind,expected]of [[savedCrew,undefined,0],[savedCrew,'crew',9],[savedCrew.map((p,i)=>i===0?{...p,name:'My edited player'}:p),undefined,9]]){
    const raw=JSON.stringify({version:1,...(kind?{kind}:{}),players:crew});
    await page.evaluate(({key,raw})=>localStorage.setItem(key,raw),{key,raw});
    await page.reload();await page.locator('#manage-top').click();
    assert.equal(await page.locator('#players-list .player-row').count(),expected);
    await page.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),raw);
  }
  pass('untouched old demo records are recognized without a write; explicit or modified crews remain intact');
  await page.evaluate(key=>localStorage.setItem(key,'{broken'),key);await page.reload();
  assert.ok(await page.locator('#storage-warning').isVisible());
  await page.locator('#manage-top').click();await page.locator('#new-name').fill('Replacement');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Add player',exact:true}).click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),'{broken');
  assert.equal(await page.locator('#players-list .player-row').count(),0);
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Add player',exact:true}).click();
  assert.equal(await page.locator('#players-list .player-row').count(),1);
  await page.getByRole('button',{name:'Done',exact:true}).click();
  assert.ok(await page.locator('#storage-warning').isHidden());
  pass('unreadable saved data is not overwritten by loading or editing without replacement confirmation');

  const installed=await browser.newContext({reducedMotion:'reduce'});
  await installed.addInitScript(()=>{
    const match=matchMedia.bind(window);
    window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true,addEventListener(){}}:match(query);
  });
  const app=await installed.newPage();app.on('pageerror',error=>errors.push(error.message));
  await app.goto(base);await app.locator('.selected').waitFor();
  assert.ok(await app.locator('#spin-button').isDisabled());
  assert.equal(await app.locator('.selected').textContent(),'Everyone’s invited.');
  await app.locator('#manage-top').click();assert.equal(await app.locator('#players-list .player-row').count(),0);
  assert.equal(await app.evaluate(()=>document.activeElement.id),'new-name');
  await app.locator('#new-name').fill('Installed Player');await app.getByRole('button',{name:'Add player',exact:true}).click();
  await app.getByRole('button',{name:'Done',exact:true}).click();
  await app.reload();assert.equal(await app.locator('.selected').textContent(),'Installed Player');
  pass('installed app starts ready for a real crew, not demos, and preserves the crew after reload');
  await installed.close();

  // Change app-window mode during an in-flight sample spin: never replace the
  // moving track mid-flight; use the new mode only after successful cleanup.
  const transition=await browser.newContext({reducedMotion:'no-preference'});
  await transition.addInitScript(()=>{
    const match=matchMedia.bind(window),listeners=[];
    window.appMode=false;
    window.matchMedia=query=>query==='(display-mode: standalone)'?{get matches(){return window.appMode;},addEventListener(type,fn){listeners.push(fn);}}:match(query);
    window.enterApp=()=>{window.appMode=true;for(const fn of listeners)fn({matches:true});};
  });
  const moving=await transition.newPage();await moving.goto(base);await moving.locator('#spin-button').click();
  await moving.locator('#reel-track').evaluate(track=>track.getAnimations()[0].pause());
  const rows=await moving.locator('.reel-name').count();
  await moving.evaluate(()=>enterApp());
  assert.equal(await moving.locator('.reel-name').count(),rows);
  await moving.locator('#reel-track').evaluate(track=>track.getAnimations()[0].finish());
  await moving.waitForFunction(()=>!document.querySelector('#machine').classList.contains('is-spinning'));
  assert.ok(await moving.locator('#spin-button').isDisabled());
  assert.equal(await moving.locator('.selected').textContent(),'Everyone’s invited.');
  pass('changing app mode during a spin waits for landing before clearing ephemeral samples');
  await transition.close();
  assert.deepEqual(errors,[]);
  await context.close();
  await writeFile(resolve(root,'test-results/sample-crew-results.json'),JSON.stringify({checks,errors},null,2)+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}