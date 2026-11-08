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
const pass=text=>{checks.push(text);console.log(`PASS ${text}`);};
try{
  const context=await browser.newContext({viewport:{width:640,height:1016},reducedMotion:'no-preference'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);await page.locator('.selected').waitFor();
  const box=await page.locator('#reel-gesture').boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
  const drag=async dy=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x,y+dy,{steps:8});};
  const snapshot=()=>page.locator('#reel-track').evaluate(track=>[...track.children].map(node=>({name:node.textContent,y:node.getBoundingClientRect().top})).filter(item=>item.y>150&&item.y<700));
  await page.mouse.click(x,y);
  assert.equal(await page.locator('#reel-track').evaluate(node=>node.getAnimations().length),0);
  await drag(7);await page.mouse.up();assert.equal(await page.locator('#reel-track').evaluate(node=>node.getAnimations().length),0);
  pass('tap and seven-pixel movement do not start a draw');
  for(const ending of ['release','resize']){
    await page.mouse.move(x,y);await page.mouse.down();
    await page.locator('#spin-button').focus();await page.keyboard.press('Enter');
    await page.locator('#reel-track').evaluate(track=>track.getAnimations()[0].pause());
    if(ending==='resize')await page.evaluate(()=>dispatchEvent(new Event('resize')));
    await page.mouse.up();
    assert.ok(await page.locator('#reel-track').evaluate(track=>track.children.length>7&&track.getAnimations().length===1));
    assert.ok(await page.locator('#manage-top').isDisabled());
    await page.locator('#reel-track').evaluate(track=>track.getAnimations()[0].finish());
    await page.waitForFunction(()=>!document.querySelector('#spin-button').disabled);
  }
  pass('a held, untouched pointer cannot overwrite a keyboard spin when released or canceled');
  for(const dy of [-83,83]){
    await drag(dy);
    assert.ok(await page.locator('#spin-button').isDisabled());
    assert.ok(await page.locator('#manage-top').isDisabled());
    assert.ok(await page.locator('#settings-open').isDisabled());
    const before=await snapshot();
    // Pause new animations at zero to compare the exact release pose.
    await page.evaluate(()=>{const original=Element.prototype.animate;Element.prototype.animate=function(...args){const animation=original.apply(this,args);animation.pause();animation.currentTime=0;return animation;};});
    await page.mouse.up();
    const after=await snapshot();
    for(const item of before){const match=after.find(other=>other.name===item.name&&Math.abs(other.y-item.y)<.2);assert.ok(match,`no release jump for ${item.name}`);}
    const trajectory=await page.locator('#reel-track').evaluate(track=>{const animation=track.getAnimations()[0];const start=new DOMMatrix(getComputedStyle(track).transform).m42;animation.currentTime=100;const next=new DOMMatrix(getComputedStyle(track).transform).m42;const duration=animation.effect.getTiming().duration;animation.currentTime=duration;const frame=document.querySelector('#reel-window').getBoundingClientRect(),center=frame.y+frame.height/2+7;const closest=[...track.children].map(node=>({name:node.textContent,y:node.getBoundingClientRect().y+node.getBoundingClientRect().height/2})).sort((a,b)=>Math.abs(a.y-center)-Math.abs(b.y-center))[0];return{start,next,duration,closest};});
    assert.equal(trajectory.duration,3200);assert.ok((trajectory.next-trajectory.start)*dy>0);
    await page.locator('#reel-track').evaluate(track=>track.getAnimations()[0].finish());
    await page.waitForFunction(()=>!document.querySelector('#spin-button').disabled);
    const resting=await page.locator('.selected').evaluate(node=>({name:node.textContent,y:node.getBoundingClientRect().y+node.getBoundingClientRect().height/2}));
    assert.equal(resting.name,trajectory.closest.name);assert.ok(Math.abs(resting.y-trajectory.closest.y)<.2);
    await page.reload();await page.locator('.selected').waitFor();
  }
  pass('mouse release continues either direction without a first-frame jump, preserves 3.2s, and lands the exact selected name');
  for(const cancel of ['pointercancel','blur','resize','origin']){
    await drag(-45);
    if(cancel==='origin'){await page.mouse.move(x,y);await page.mouse.up();}
    else if(cancel==='pointercancel')await page.locator('#reel-gesture').dispatchEvent('pointercancel',{pointerId:1});
    else await page.evaluate(name=>dispatchEvent(new Event(name)),cancel);
    await page.mouse.up();
    assert.equal(await page.locator('#reel-track').evaluate(node=>node.getAnimations().length),0);
    assert.equal(await page.locator('.reel-name').count(),5);assert.ok(await page.locator('#spin-button').isEnabled());
  }
  pass('cancellation, blur, resize and return-to-origin restore the reel without a winner');
  await page.emulateMedia({reducedMotion:'reduce'});
  await drag(-45);await page.mouse.up();await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  assert.equal(await page.locator('#reel-blur').getAttribute('stdDeviation'),'0 0');
  pass('reduced-motion flick preserves the short clear result path');
  await context.close();
  const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await touch.addInitScript(()=>{
    window.flickAudio={decoded:0,events:[],signal:0};
    const decode=AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData=function(...args){
      const promise=decode.apply(this,args);
      promise.then(()=>flickAudio.decoded++).catch(()=>{});return promise;
    };
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(...args){
      const animation=animate.apply(this,args);
      if(this.id==='reel-track')animation.finished.then(()=>flickAudio.events.push({type:'land',time:performance.now()})).catch(()=>{});
      return animation;
    };
    const start=AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start=function(...args){
      if(this.buffer?.duration>.1){
        const type=this.buffer.duration>2?'wheel':'yay';
        flickAudio.events.push({type,time:performance.now(),state:this.context.state});
        if(type==='yay'){
          const analyser=this.context.createAnalyser(),silent=this.context.createGain();
          silent.gain.value=0;this.connect(analyser);analyser.connect(silent);silent.connect(this.context.destination);
          const data=new Float32Array(analyser.fftSize),until=performance.now()+1200;
          function sample(){analyser.getFloatTimeDomainData(data);for(const value of data)flickAudio.signal=Math.max(flickAudio.signal,Math.abs(value));if(performance.now()<until)requestAnimationFrame(sample);else{analyser.disconnect();silent.disconnect();}}
          requestAnimationFrame(sample);
        }
      }
      return start.apply(this,args);
    };
  });
  const tp=await touch.newPage();tp.on('pageerror',error=>errors.push(error.message));await tp.goto(base);await tp.locator('.selected').waitFor();
  await tp.waitForFunction(()=>flickAudio.decoded===2);
  const tb=await tp.locator('#reel-gesture').boundingBox(),tx=tb.x+tb.width/2,ty=tb.y+tb.height/2,cdp=await touch.newCDPSession(tp);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:tx,y:ty,id:1}]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:tx,y:ty-i*8,id:1}]});
  assert.equal(await tp.locator('.reel-name').count(),7);
  assert.equal(await tp.evaluate(()=>flickAudio.events.length),0,'dragging itself must not play sound');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await tp.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  assert.equal(await tp.locator('.selected').count(),1);
  await tp.waitForFunction(()=>flickAudio.signal>.02);
  const audio=await tp.evaluate(()=>flickAudio);
  assert.equal(audio.events.filter(event=>event.type==='wheel').length,1);
  assert.equal(audio.events.filter(event=>event.type==='yay').length,1);
  assert.ok(audio.events.filter(event=>event.type!=='land').every(event=>event.state==='running'));
  assert.ok(Math.abs(audio.events.find(event=>event.type==='yay').time-audio.events.find(event=>event.type==='land').time)<50);
  pass('browser-dispatched touch drag and release launches and completes the same spin');
  pass('touch release unlocks audio, starts one wheel, and produces non-silent Yay only at landing');
  await touch.close();assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));await writeFile(resolve(root,'test-results/gesture-results.json'),JSON.stringify({checks,errors},null,2)+'\n');}
