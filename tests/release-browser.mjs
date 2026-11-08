import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,mkdtemp,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {createStaticServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const checks=[],errors=[];
const pass=check=>{checks.push(check);console.log(`PASS ${check}`);};
let subServer,temporary;
try{
  const context=await browser.newContext({reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.locator('#settings-open').click();
  await page.getByRole('switch',{name:'Sound effects',exact:false}).uncheck();
  await page.locator('#sound-volume').fill('40');
  await page.locator('#sound-volume').dispatchEvent('input');
  await page.getByRole('switch',{name:'Reduce motion',exact:false}).check();
  await page.locator('#settings-done').click();
  await page.reload();
  await page.locator('#settings-open').click();
  assert.equal(await page.locator('#sound-enabled').isChecked(),false);
  assert.equal(await page.locator('#sound-volume').inputValue(),'40');
  assert.equal(await page.locator('#reduce-motion').isChecked(),true);
  pass('sound, volume, and motion preferences save independently and survive reload');
  await page.locator('#sound-enabled').check();
  await page.locator('#sound-volume').fill('100');await page.locator('#sound-volume').dispatchEvent('input');
  await page.locator('#reduce-motion').uncheck();
  const downloadEvent=page.waitForEvent('download');
  await page.locator('#export-players').click();
  const download=await downloadEvent;
  const backup=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(backup.version,1);assert.equal(backup.players.length,9);
  await page.locator('#import-file').setInputFiles({name:'crew.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,players:[{id:'new',name:'The New Crew',active:true}]}))});
  await page.locator('#import-keep').click();
  assert.equal(await page.locator('#top-count').textContent(),'6');
  await page.locator('#import-file').setInputFiles({name:'crew.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,players:[{id:'new',name:'The New Crew',active:true}]}))});
  await page.locator('#import-confirm').click();
  assert.equal(await page.locator('#top-count').textContent(),'1');
  await page.locator('#import-file').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{broken')});
  await page.waitForFunction(()=>document.querySelector('#backup-status').textContent.includes('not a valid'));
  assert.match(await page.locator('#backup-status').textContent(),/not a valid/);
  assert.equal(await page.locator('#top-count').textContent(),'1');
  pass('backup exports valid players; import requires confirmation and rejects invalid files without losing data');
  await page.locator('#settings-done').click();
  await page.locator('#spin-button').click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent==='The New Crew goes first!');
  pass('imported crew is immediately playable');
  // Replacing a roster invalidates any Undo associated with the old list.
  await page.locator('#manage-top').click();
  await page.getByRole('button',{name:'Remove The New Crew',exact:true}).click();
  await page.keyboard.press('Escape');
  await page.locator('#settings-open').click();
  await page.locator('#import-file').setInputFiles({name:'crew.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,players:[{id:'new',name:'The New Crew',active:true}]}))});
  await page.locator('#import-confirm').click();
  await page.locator('#settings-done').click();
  assert.ok(await page.locator('#toast').isHidden());
  await page.locator('#undo-delete').evaluate(button=>button.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await page.reload();
  assert.equal(await page.locator('#top-count').textContent(),'1');
  assert.equal(await page.locator('.selected').textContent(),'The New Crew');
  pass('import clears stale deletion Undo and the replaced roster remains valid after reload');

  // Return demo data for visual captures and boundary checks.
  await page.evaluate(()=>{localStorage.removeItem('who-goes-first:players:v1');localStorage.removeItem('who-goes-first:settings:v1');});
  await page.reload();
  for(const [width,height,label]of [[320,568,'small-phone'],[390,844,'phone'],[520,780,'split-pane'],[699,520,'stacked-boundary'],[700,520,'wide-boundary'],[768,1024,'tablet'],[844,390,'landscape'],[960,500,'wide-short'],[1440,1000,'desktop']]){
    await page.setViewportSize({width,height});
    await page.locator('#settings-open').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} main overflow`);
    for(const id of ['#spin-button','#manage-top','#settings-open']){
      const box=await page.locator(id).boundingBox();
      assert.ok(box.width>=44 && box.height>=44,`${label} ${id} touch target`);
      assert.ok(box.x>=0&&box.x+box.width<=width+.1);
    }
    const geometry=await page.evaluate(()=>{
      const ids=['.machine','#spin-button','#manage-top','#settings-open'];
      return ids.map(id=>{const r=document.querySelector(id).getBoundingClientRect();return {id,x:r.x,y:r.y,w:r.width,h:r.height};});
    });
    for(let i=0;i<geometry.length;i++)for(let j=i+1;j<geometry.length;j++){
      const a=geometry[i],b=geometry[j];
      const overlapX=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x);
      const overlapY=Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y);
      assert.ok(overlapX<=1||overlapY<=1,`${label} ${a.id} overlaps ${b.id}`);
    }
    assert.ok(Math.abs(geometry[0].w/geometry[0].h-585/532)<.001,`${label} stretched machine`);
    assert.ok(await page.evaluate(()=>[...document.querySelectorAll('.art-control img')].every(img=>img.complete&&img.naturalWidth>0)),`${label} missing original lettering`);
    await page.screenshot({path:resolve(root,`test-results/release-${label}.png`),fullPage:true});
    await page.locator('#manage-top').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} editor overflow`);
    await page.getByRole('button',{name:'Done',exact:true}).click();
    await page.locator('#settings-open').click();
    await page.locator('#settings-close').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} settings overflow`);
    await page.screenshot({path:resolve(root,`test-results/release-${label}-settings.png`),fullPage:true});
    await page.locator('#sound-credits').click();
    await page.locator('#close-credits').scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${label} credits overflow`);
    await page.locator('#close-credits').click();
    assert.equal(await page.evaluate(()=>document.activeElement.id),'sound-credits');
    await page.locator('#settings-close').click();
  }
  pass('phone, tablet, desktop, and landscape controls stay at least 44px and all themed panels fit without horizontal overflow');
  assert.equal(await page.locator('.app-nav #sound-credits').count(),0);
  assert.equal(await page.locator('.app-nav').count(),0);
  assert.equal(await page.locator('#manage-nav').count(),0);
  assert.equal(await page.locator('.original-screen #settings-open svg').count(),1);
  assert.equal(await page.locator('#settings-dialog .dialog-footer #sound-credits').count(),1);
  pass('Sound credits is a subtle Settings footer link, not a main-screen control, with nested focus restored');
  await page.locator('#settings-open').click();
  await page.locator('#install-help').click();
  assert.match(await page.locator('#install-dialog').textContent(),/Safari/);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'settings-open');
  pass('nested dialogs preserve native keyboard dismissal and return focus to Settings');

  temporary=await mkdtemp(resolve(tmpdir(),'wgf-release-'));
  await mkdir(resolve(temporary,'games'),{recursive:true});
  await cp(resolve(root,'dist'),resolve(temporary,'games/first'),{recursive:true});
  subServer=createStaticServer(temporary);
  await new Promise(resolve=>subServer.listen(0,'127.0.0.1',resolve));
  const subbase=`http://127.0.0.1:${subServer.address().port}/games/first`;
  const response=await page.request.get(subbase,{maxRedirects:0});
  assert.equal(response.status(),308);
  assert.equal(response.headers().location,'/games/first/');
  await page.goto(subbase);
  assert.equal(page.url(),subbase+'/');
  await page.waitForFunction(()=>document.querySelectorAll('.reel-name').length===5);
  const manifest=await(await page.request.get(subbase+'/manifest.webmanifest')).json();
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.theme_color,'#9d6b0d');
  const client=await context.newCDPSession(page);
  assert.deepEqual((await client.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
  await page.evaluate(async()=>{
    await navigator.serviceWorker.ready;
    if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  await context.setOffline(true);await page.reload();
  await page.locator('#spin-button').click();
  await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  await page.locator('#settings-open').click();
  assert.match(await page.locator('#offline-detail').textContent(),/Offline play is ready/);
  pass('HTTPS-ready static release also installs structurally and reloads offline at a nested /games/first/ path');
  assert.deepEqual(errors,[]);
  pass('no uncaught errors across responsive settings, backups, and subpath offline play');
  await context.close();
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  if(subServer)await new Promise(resolve=>subServer.close(resolve));
  if(temporary)await rm(temporary,{recursive:true,force:true});
  await writeFile(resolve(root,'test-results/release-results.json'),JSON.stringify({checks,errors},null,2)+'\n');
}