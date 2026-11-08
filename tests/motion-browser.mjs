import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const checks=[],frames=[];
const pass=check=>{checks.push(check);console.log(`PASS ${check}`);};
try{
  const page=await browser.newPage({viewport:{width:640,height:1016},reducedMotion:'no-preference'});
  await page.goto(base);
  await page.waitForFunction(()=>document.querySelectorAll('.reel-name').length===5);
  await page.locator('#spin-button').click();
  await page.locator('#reel-track').evaluate(track=>{track.getAnimations()[0].pause();});
  const opening=await page.locator('#reel-track').evaluate(track=>{
    const animation=track.getAnimations()[0];
    const positions=[0,160,640,1280,2240].map(time=>{
      animation.currentTime=time;
      return new DOMMatrix(getComputedStyle(track).transform).m42;
    });
    animation.currentTime=3200;
    const final=new DOMMatrix(getComputedStyle(track).transform).m42;
    const rowHeight=track.firstElementChild.getBoundingClientRect().height;
    return {positions,final,rowHeight,duration:animation.effect.getTiming().duration};
  });
  const speed=Math.abs(opening.positions[1]-opening.positions[0])/160;
  assert.ok(Math.abs((opening.positions[2]-opening.positions[1])/480)/speed>.99);
  assert.ok(Math.abs((opening.positions[3]-opening.positions[2])/640)/speed>.99);
  assert.ok(Math.abs((opening.positions[4]-opening.positions[3])/960)/speed<.75);
  assert.ok(Math.abs(opening.positions[1])/opening.rowHeight>7,'Opening keeps at least seven rows of travel in 160ms');
  assert.equal(opening.duration,3200);
  pass('reel holds opening speed through 1.28s, then brakes more steeply within the same 3.2s');
  for(const time of [400,1600,2400,2700,2880,3040,3168,3190]){
    await page.locator('#reel-track').evaluate((track,time)=>{track.getAnimations()[0].currentTime=time;},time);
    // Two animation frames let the model-driven directional filter catch up.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const state=await page.evaluate(()=>{
      const blur=document.querySelector('#reel-blur').getAttribute('stdDeviation').split(/\s+/).map(Number);
      const track=document.querySelector('#reel-track');
      const names=[...track.children];
      const frame=document.querySelector('#reel-window').getBoundingClientRect();
      const center=frame.y+frame.height/2+7;
      const closest=names.map(node=>({name:node.textContent,y:node.getBoundingClientRect().y+node.getBoundingClientRect().height/2})).sort((a,b)=>Math.abs(a.y-center)-Math.abs(b.y-center))[0];
      return {blurX:blur[0],blurY:blur[1],transform:new DOMMatrix(getComputedStyle(track).transform).m42,closest};
    });
    assert.ok(state.blurX<state.blurY/10);
    if(frames.length)assert.ok(state.blurY<=frames.at(-1).blurY+.001);
    frames.push({time,...state});
    if([400,2700,3040,3190].includes(time)){
      await page.locator('.original-screen').screenshot({path:resolve(root,`test-results/motion-${time}.png`)});
    }
  }
  assert.ok(frames[0].blurY>6);
  assert.ok(frames.find(frame=>frame.time===2700).blurY<2);
  assert.ok(frames.at(-1).blurY<.1);
  pass('directional blur progressively clears as the measured reel velocity falls');
  const finalAnimated=frames.at(-1);
  await page.locator('#reel-track').evaluate(track=>{track.getAnimations()[0].finish();});
  await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  const resting=await page.evaluate(()=>{
    const selected=document.querySelector('.selected');
    return {name:selected.textContent,y:selected.getBoundingClientRect().y+selected.getBoundingClientRect().height/2,
      blur:document.querySelector('#reel-blur').getAttribute('stdDeviation')};
  });
  assert.equal(resting.blur,'0 0');
  assert.equal(resting.name,finalAnimated.closest.name);
  assert.ok(Math.abs(resting.y-finalAnimated.closest.y)<.2);
  await page.locator('.original-screen').screenshot({path:resolve(root,'test-results/motion-rest.png')});
  pass('last animated frame is already clear and aligned; landing adds no clarity or position snap');

  // Prove the filter changes rendered pixels, not merely DOM attributes.
  await page.locator('#reel-blur').evaluate(node=>node.setAttribute('stdDeviation','0.4 12'));
  const blurred=await page.locator('.reel-window').screenshot();
  await page.locator('#reel-blur').evaluate(node=>node.setAttribute('stdDeviation','0 0'));
  const clear=await page.locator('.reel-window').screenshot();
  assert.notDeepEqual(blurred,clear);
  pass('SVG directional motion filter visibly changes name pixels without changing the artwork');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#spin-button').click();
  assert.equal(await page.locator('.reel-window').evaluate(node=>getComputedStyle(node).filter),'none');
  await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  pass('reduced-motion spins stay clear and settle immediately');

  // Also run the inline app inside a Canvas-style sandbox with no connections.
  const preview=await readFile(resolve(root,'test-results/preview.html'),'utf8');
  const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'";
  const embedded=preview.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
  const shell=await browser.newPage({viewport:{width:680,height:1000},reducedMotion:'no-preference'});
  await shell.setContent('<iframe id="app" sandbox="allow-scripts allow-modals" style="width:640px;height:956px;border:0"></iframe>');
  await shell.locator('#app').evaluate((iframe,body)=>{iframe.srcdoc=body;},embedded);
  const child=shell.frameLocator('#app');
  await child.locator('#spin-button').click();
  await child.locator('#reel-track').evaluate(track=>{const animation=track.getAnimations()[0];animation.pause();animation.currentTime=1800;});
  const frame=shell.frames().find(frame=>frame.parentFrame());
  await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await child.locator('#reel-blur').evaluate(node=>node.setAttribute('stdDeviation','0 0'));
  // Keep blur fixed only for the screenshot comparison; paused animation's RAF
  // would otherwise replace it on the next frame. Use an independent filter.
  await frame.evaluate(()=>{
    const filter=document.querySelector('#reel-motion-blur').cloneNode(true);
    filter.id='test-motion-filter';
    filter.firstElementChild.removeAttribute('id');
    filter.firstElementChild.setAttribute('stdDeviation','0 0');
    document.querySelector('defs').append(filter);
    document.querySelector('.reel-window').style.filter='url(#test-motion-filter)';
  });
  const noBlur=await child.locator('.reel-window').screenshot();
  await frame.evaluate(()=>document.querySelector('#test-motion-filter feGaussianBlur').setAttribute('stdDeviation','0.4 12'));
  const withBlur=await child.locator('.reel-window').screenshot();
  assert.notDeepEqual(noBlur,withBlur);
  pass('directional blur also renders in the opaque-origin no-network preview sandbox');
  await shell.close();
}finally{
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await writeFile(resolve(root,'test-results/motion-results.json'),JSON.stringify({checks,frames},null,2)+'\n');
}