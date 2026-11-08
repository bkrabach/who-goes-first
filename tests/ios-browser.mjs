import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`,browser=await chromium.launch({headless:true});
const checks=[],errors=[];
const pass=check=>{checks.push(check);console.log(`PASS ${check}`);};
try{
  for(const scenario of ['iphone','ipad-desktop','android','desktop','ios-unsupported','ios-rejected','ios-getter-error']){
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
    await context.addInitScript(scenario=>{
      const ios=!['android','desktop'].includes(scenario);
      const ipad=scenario==='ipad-desktop';
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
    },scenario);
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
    await page.waitForFunction(()=>document.querySelector('#test-sound').dataset.loaded==='true');
    await page.locator('#settings-open').click();
    const ios=!['android','desktop'].includes(scenario),supported=!['ios-unsupported','ios-getter-error'].includes(scenario);
    assert.equal(await page.locator('#silent-mode-help').isVisible(),ios);
    assert.equal(await page.locator('#silent-mode-row').isVisible(),ios);
    assert.deepEqual(await page.evaluate(()=>iosEvidence.writes),[],'loading must never interrupt music');
    assert.equal(await page.locator('#play-in-silent-mode').isChecked(),false);
    if(!ios){
      assert.equal(await page.evaluate(()=>iosEvidence.gets),0,'do not touch the optional iOS policy on other platforms');
    }else if(!supported){
      assert.ok(await page.locator('#play-in-silent-mode').isDisabled());
      assert.match(await page.locator('#silent-mode-option-help').textContent(),/Not available/);
      await page.locator('#settings-done').click();await page.locator('#spin-button').click();
      await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
      assert.deepEqual(await page.evaluate(()=>iosEvidence.writes),[]);
    }else{
      assert.match(await page.locator('#silent-mode-option-help').textContent(),/May pause music/);
      await page.locator('#play-in-silent-mode').check();
      assert.deepEqual(await page.evaluate(()=>iosEvidence.writes),[],'preference change is not audio playback');
      await page.reload();await page.locator('#settings-open').click();
      assert.ok(await page.locator('#play-in-silent-mode').isChecked());
      assert.deepEqual(await page.evaluate(()=>iosEvidence.writes),[],'saved opt-in does not claim audio at launch');
      await page.locator('#settings-done').click();await page.locator('#spin-button').click();
      await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
      if(scenario==='ios-rejected'){
        assert.ok((await page.evaluate(()=>iosEvidence.writes)).includes('playback'));
      }else{
        await page.waitForFunction(()=>iosEvidence.writes.includes('auto'));
        assert.deepEqual(await page.evaluate(()=>iosEvidence.writes),['playback','auto']);
        assert.equal(await page.evaluate(()=>iosEvidence.starts.filter(event=>event.duration<2&&event.type==='playback').length),1);
      }
      await page.locator('#settings-open').click();await page.locator('#sound-enabled').uncheck();
      const before=await page.evaluate(()=>iosEvidence.writes.length);
      await page.locator('#settings-done').click();await page.locator('#spin-button').click();
      await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
      assert.equal(await page.evaluate(()=>iosEvidence.writes.length),before,'muted game never takes audio focus');
    }
    assert.equal(await page.evaluate(()=>iosEvidence.fullscreen+iosEvidence.locks),0);
    await context.close();
  }
  pass('Silent Mode note and option appear only on detected iPhone/iPad, including iPad desktop mode');
  pass('option defaults off, persists opt-in, and requests playback only within the spin gesture');
  pass('cue ends restore the prior policy; mute, unsupported APIs and rejection remain safe');
  pass('portrait manifest is requested without forced fullscreen or unsupported JavaScript locks');
  assert.deepEqual(errors,[]);
}finally{
  await browser.close();await new Promise(resolve=>server.close(resolve));
  await writeFile(resolve(root,'test-results/ios-browser-results.json'),JSON.stringify({checks,errors,limits:['iOS detection and audio-session interactions are simulated in Chromium. Actual iPhone Silent Mode, other-music interaction, and installed Android orientation require physical-device checks.']},null,2)+'\n');
}
