import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=process.env.IOS_TEST_BASE_URL||`http://127.0.0.1:${server.address().port}/`,browser=await chromium.launch({headless:true});
const checks=[],errors=[];
const pass=check=>{checks.push(check);console.log(`PASS ${check}`);};
try{
  for(const scenario of ['iphone','ipad-desktop','android','desktop','ios-unsupported','ios-rejected','ios-getter-error']){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.addInitScript(scenario=>{
      const ios=!['android','desktop'].includes(scenario),ipad=scenario==='ipad-desktop';
      Object.defineProperty(navigator,'userAgent',{value:ipad?'Mozilla/5.0 (Macintosh) Version/18 Safari':ios?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari':scenario==='android'?'Mozilla/5.0 Android Chrome':'Mozilla/5.0 Macintosh Safari'});
      Object.defineProperty(navigator,'platform',{value:ipad||scenario==='desktop'?'MacIntel':ios?'iPhone':'Linux armv8l'});
      Object.defineProperty(navigator,'maxTouchPoints',{value:scenario==='desktop'?0:5});
      window.iosEvidence={writes:[],gets:0,starts:[],fullscreen:0,locks:0};
      let type='auto';
      const session={get type(){return type;},set type(value){iosEvidence.writes.push(value);if(scenario==='ios-rejected')throw new Error('Policy rejected');type=value;}};
      Object.defineProperty(navigator,'audioSession',{get(){iosEvidence.gets++;if(scenario==='ios-getter-error')throw new Error('Unavailable');return scenario==='ios-unsupported'?undefined:session;}});
      const start=AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start=function(...args){if(this.buffer?.duration>.1)iosEvidence.starts.push({duration:this.buffer.duration,type});return start.apply(this,args);};
      Object.defineProperty(Element.prototype,'requestFullscreen',{value:()=>{iosEvidence.fullscreen++;return Promise.reject(new Error('No forced fullscreen'));},configurable:true});
      if(screen.orientation)Object.defineProperty(screen.orientation,'lock',{value:()=>{iosEvidence.locks++;return Promise.reject(new Error('Unsupported'));},configurable:true});
      // Reproduce someone who opted in before removal, without reseeding reloads.
      if(localStorage.getItem('who-goes-first:settings:v1')===null){
        localStorage.setItem('who-goes-first:settings:v1',JSON.stringify({version:1,settings:{sound:true,volume:40,motion:'reduced',playInSilentMode:true}}));
        localStorage.setItem('who-goes-first:players:v1',JSON.stringify({version:1,kind:'crew',players:[{id:'keep-a',name:'Keep Alice',active:true},{id:'keep-b',name:'Keep Bob',active:true}]}));
      }
    },scenario);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#test-sound').dataset.loaded==='true'&&document.querySelector('#test-wheel').dataset.loaded==='true');
    const saved=await page.evaluate(()=>({players:localStorage.getItem('who-goes-first:players:v1'),settings:localStorage.getItem('who-goes-first:settings:v1')}));
    await page.locator('#settings-open').click();
    const ios=!['android','desktop'].includes(scenario);
    assert.equal(await page.locator('#silent-mode-help').isVisible(),ios);
    assert.match(await page.locator('#silent-mode-help').textContent(),/Turn Silent Mode off/);
    assert.equal(await page.locator('#silent-mode-row, #play-in-silent-mode').count(),0,'removed option must not merely be hidden');
    assert.ok(await page.locator('#sound-enabled').isChecked());
    assert.equal(await page.locator('#sound-volume').inputValue(),'40');
    assert.ok(await page.locator('#reduce-motion').isChecked());
    assert.equal(await page.locator('#settings-save-status').textContent(),'Saved on this device.');
    assert.equal(await page.evaluate(()=>localStorage.getItem('who-goes-first:settings:v1')),saved.settings,'opening settings does not rewrite user data');
    await page.locator('#settings-done').click();await page.locator('#spin-button').click();
    await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
    assert.equal(await page.evaluate(()=>iosEvidence.starts.filter(event=>event.duration<2).length),1);
    await page.locator('#settings-open').click();await page.locator('#sound-credits').click();
    const before=await page.evaluate(()=>iosEvidence.starts.length);
    await page.locator('#test-sound').click();
    await page.waitForFunction(before=>iosEvidence.starts.length===before+1,before);
    await page.locator('#test-wheel').click();
    await page.waitForFunction(before=>iosEvidence.starts.length===before+2,before);
    await page.locator('#close-credits').click();
    await page.locator('#sound-volume').fill('35');await page.locator('#sound-volume').dispatchEvent('input');
    const current=await page.evaluate(()=>JSON.parse(localStorage.getItem('who-goes-first:settings:v1')));
    assert.deepEqual(current,{version:1,settings:{sound:true,volume:35,motion:'reduced'}});
    assert.equal(await page.evaluate(()=>localStorage.getItem('who-goes-first:players:v1')),saved.players);
    await page.locator('#sound-enabled').uncheck();await page.locator('#settings-done').click();
    const unmutedStarts=await page.evaluate(()=>iosEvidence.starts.length);
    await page.locator('#spin-button').click();await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
    assert.equal(await page.evaluate(()=>iosEvidence.starts.length),unmutedStarts,'ordinary sound toggle still mutes the game');
    const interactionEvidence=await page.evaluate(()=>iosEvidence);
    assert.equal(interactionEvidence.gets,0,'spin, sound tests, mute and save never read audio-session policy');
    assert.deepEqual(interactionEvidence.writes,[]);
    assert.equal(interactionEvidence.fullscreen+interactionEvidence.locks,0);
    await page.reload();await page.locator('#settings-open').click();
    assert.equal(await page.locator('#silent-mode-help').isVisible(),ios);
    assert.equal(await page.locator('#play-in-silent-mode').count(),0);
    assert.equal(await page.locator('#sound-volume').inputValue(),'35');assert.equal(await page.locator('#sound-enabled').isChecked(),false);
    const evidence=await page.evaluate(()=>iosEvidence);
    assert.equal(evidence.gets,0,'no runtime path even reads the audio-session API');
    assert.deepEqual(evidence.writes,[]);assert.equal(evidence.fullscreen+evidence.locks,0);
    await context.close();
  }
  const manifest=await(await fetch(new URL('manifest.webmanifest',base))).json();assert.equal(manifest.orientation,'portrait');
  pass('only detected iPhone/iPad shows the Silent Mode note; the removed option is absent everywhere');
  pass('previously saved opt-ins cannot activate an override or discard sound, volume, motion or crew');
  pass('spin and sound-test paths never access audio-session policy; normal mute/save/reload still work');
  pass('portrait preference and usable rotation fallback remain unchanged, without forced fullscreen');
  assert.deepEqual(errors,[]);
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(resolve(root,'test-results/ios-browser-results.json'),JSON.stringify({url:base,checks,errors,limits:['iOS detection is simulated in Chromium. No claim of physical iPhone Silent Mode or native orientation verification.']},null,2)+'\n');
}
