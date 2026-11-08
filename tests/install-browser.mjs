import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStaticServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const server=createStaticServer(resolve(root,'dist'));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/`;
const browser=await chromium.launch({headless:true});
const checks=[],errors=[];
const pass=message=>{checks.push(message);console.log(`PASS ${message}`);};
try{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base);
  await page.locator('#install-tip').waitFor({state:'visible'});
  assert.ok(await page.locator('#install-tip').evaluate(node=>node.getBoundingClientRect().top>=document.querySelector('.original-screen').getBoundingClientRect().bottom));
  assert.equal(await page.locator('#install-tip-install').isHidden(),true);
  await page.screenshot({path:resolve(root,'test-results/install-tip-phone.png'),fullPage:true});
  await page.locator('#install-tip-help').click();
  assert.match(await page.locator('#install-steps').textContent(),/install icon|Install app|Home Screen|Dock/);
  assert.doesNotMatch(await page.locator('#install-dialog').textContent(),/\bPWA\b|standalone|manifest/);
  await page.keyboard.press('Escape');
  await page.locator('#install-tip-dismiss').click();
  await page.reload();
  assert.ok(await page.locator('#install-tip').isHidden());
  await page.locator('#settings-open').click();
  await page.locator('#install-help').click();
  assert.ok(await page.locator('#install-dialog').isVisible());
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  pass('browser-only consumer tip stays below the artwork, dismissal survives reload, and Settings retains guidance');

  // A deferred browser prompt is only invoked from an explicit user click.
  await page.evaluate(()=>{
    window.promptCalls=0;
    const event=new Event('beforeinstallprompt',{cancelable:true});
    event.prompt=()=>{promptCalls++;return Promise.resolve();};
    event.userChoice=Promise.resolve({outcome:'dismissed'});
    dispatchEvent(event);
  });
  assert.equal(await page.evaluate(()=>promptCalls),0);
  assert.ok(await page.locator('#install-tip').isHidden());
  await page.locator('#settings-open').click();await page.locator('#install-help').click();
  await page.locator('#install-button').click();
  assert.equal(await page.evaluate(()=>promptCalls),1);
  assert.ok(await page.locator('#install-button').isHidden());
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.evaluate(()=>dispatchEvent(new Event('appinstalled')));
  assert.ok(await page.locator('#install-tip').isHidden());
  await page.locator('#settings-open').click();
  assert.ok(await page.locator('#fit-portrait').isHidden(),'installing does not turn the originating browser tab into an app window');
  await page.locator('#settings-done').click();
  pass('install prompts wait for a click, a dismissed suggestion stays dismissed, and installation hides the panel');

  for(const mode of ['standalone','ios']){
    const app=await browser.newContext({viewport:{width:500,height:800}});
    await app.addInitScript(mode=>{
      if(mode==='ios')Object.defineProperty(navigator,'standalone',{value:true});
      else{
        const match=window.matchMedia.bind(window);
        window.matchMedia=query=>query==='(display-mode: standalone)'?{matches:true,addEventListener(){}}:match(query);
      }
      Object.defineProperty(window,'resizeTo',{value:(width,height)=>{window.resizeRequest={width,height};}});
    },mode);
    const p=await app.newPage();p.on('pageerror',error=>errors.push(error.message));
    await p.goto(base);await p.locator('.selected').waitFor();
    assert.ok(await p.locator('#install-tip').isHidden());
    await p.locator('#settings-open').click();
    assert.ok(await p.locator('#fit-portrait').isVisible());
    assert.equal(await p.evaluate(()=>window.resizeRequest),undefined);
    await p.locator('#fit-portrait').click();
    const resize=await p.evaluate(()=>window.resizeRequest);
    assert.ok(resize.width>0&&resize.height>resize.width);
    await p.waitForFunction(()=>document.querySelector('#window-size-status').textContent.length>0);
    assert.match(await p.locator('#window-size-status').textContent(),/browser controls|Portrait window/);
    await app.close();
  }
  pass('standalone and iOS launch signals suppress the tip; desktop portrait fitting is user-triggered and best effort');
  const fullscreen=await browser.newContext();
  await fullscreen.addInitScript(()=>{
    const match=window.matchMedia.bind(window);
    window.matchMedia=query=>query==='(display-mode: fullscreen)'?{matches:true,addEventListener(){}}:match(query);
  });
  const fullPage=await fullscreen.newPage();await fullPage.goto(base);
  await fullPage.locator('#install-tip').waitFor({state:'visible'});
  await fullPage.locator('#settings-open').click();
  assert.ok(await fullPage.locator('#fit-portrait').isHidden());
  await fullscreen.close();
  pass('fullscreen browser use is not mistaken for an installed app');
  const overlay=await browser.newContext({viewport:{width:640,height:1016}});
  await overlay.addInitScript(()=>{
    const chrome=new EventTarget();
    chrome.visible=true;
    chrome.rect={x:90,y:0,width:500,height:40};
    chrome.getTitlebarAreaRect=()=>chrome.rect;
    Object.defineProperty(navigator,'windowControlsOverlay',{value:chrome});
  });
  const op=await overlay.newPage();op.on('pageerror',error=>errors.push(error.message));await op.goto(base);
  await op.locator('#window-drag-strip').waitFor({state:'visible'});
  const strip=await op.locator('#window-drag-strip').boundingBox();
  assert.deepEqual(strip,{x:90,y:0,width:500,height:40});
  assert.ok(await op.locator('#settings-open').evaluate(node=>node.getBoundingClientRect().top>=40));
  assert.equal(await op.locator('#window-drag-strip').evaluate(node=>getComputedStyle(node).getPropertyValue('app-region')),'drag');
  await op.locator('#settings-open').click();
  assert.ok(await op.locator('#settings-dialog').evaluate(node=>node.getBoundingClientRect().top>=40));
  async function checkModalChrome(id){
    const modalStrip=op.locator(`#${id} .modal-window-drag-strip`);
    assert.deepEqual(await modalStrip.boundingBox(),{x:90,y:0,width:500,height:40});
    assert.equal(await modalStrip.evaluate(node=>getComputedStyle(node).getPropertyValue('app-region')),'drag');
    assert.ok(await op.evaluate(id=>{
      const hit=document.elementFromPoint(320,20);
      return hit?.matches('.modal-window-drag-strip')&&hit.closest('dialog').id===id;
    },id),'top-layer drag strip receives the title-region hit, not the backdrop');
    const bar=await op.locator(`#${id}`).evaluate(node=>{
      const style=getComputedStyle(node,'::before');return{width:style.width,height:style.height,color:style.backgroundColor,content:style.content};
    });
    assert.deepEqual(bar,{width:'640px',height:'40px',color:'rgb(157, 107, 13)',content:'""'});
    await op.mouse.click(320,20);
    assert.ok(await op.locator(`#${id}`).isVisible(),'title-region click must not dismiss the modal');
  }
  await checkModalChrome('settings-dialog');
  await op.locator('#settings-dialog').evaluate(node=>{node.scrollTop=node.scrollHeight;});
  await checkModalChrome('settings-dialog');
  await op.locator('#sound-credits').click();
  await checkModalChrome('credits-dialog');
  await op.keyboard.press('Escape');
  await checkModalChrome('settings-dialog');
  await op.keyboard.press('Escape');
  await op.locator('#manage-top').click();
  await checkModalChrome('players-dialog');
  await op.keyboard.press('Escape');
  await op.evaluate(()=>{navigator.windowControlsOverlay.visible=false;navigator.windowControlsOverlay.dispatchEvent(new Event('geometrychange'));});
  await op.locator('#window-drag-strip').waitFor({state:'hidden'});
  await op.evaluate(()=>{navigator.windowControlsOverlay.visible=true;navigator.windowControlsOverlay.rect={x:0,y:0,width:500,height:32};navigator.windowControlsOverlay.dispatchEvent(new Event('geometrychange'));});
  await op.waitForFunction(()=>document.querySelector('#window-drag-strip').getBoundingClientRect().height===32);
  assert.equal((await op.locator('#window-drag-strip').boundingBox()).x,0);
  await overlay.close();
  assert.ok(await page.locator('#window-drag-strip').isHidden());
  pass('overlay geometry reserves the OS titlebar, leaves controls usable, reacts to toggle/resize, and falls back without the API');
  pass('solid gold titlebar has no duplicate title; scrolled and nested dialogs retain their own drag surface without dismissal');
  for(const failure of ['geometry','listener']){
    const broken=await browser.newContext();
    await broken.addInitScript(failure=>{
      Object.defineProperty(navigator,'windowControlsOverlay',{value:{
        visible:true,
        getTitlebarAreaRect(){throw new Error('Optional native geometry unavailable');},
        addEventListener(){if(failure==='listener')throw new Error('Optional native listener unavailable');}
      }});
    },failure);
    const bp=await broken.newPage();bp.on('pageerror',error=>errors.push(error.message));await bp.goto(base);
    await bp.locator('.selected').waitFor();
    assert.ok(await bp.locator('#window-drag-strip').isHidden());
    await bp.locator('#spin-button').click();
    await bp.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
    await broken.close();
  }
  pass('optional native overlay errors fall back without breaking game initialization or selection');

  const blocked=await browser.newContext({viewport:{width:320,height:568},reducedMotion:'reduce'});
  await blocked.addInitScript(()=>{
    Storage.prototype.getItem=()=>{throw new DOMException('Blocked','SecurityError');};
    Storage.prototype.setItem=()=>{throw new DOMException('Blocked','SecurityError');};
  });
  const denied=await blocked.newPage();denied.on('pageerror',error=>errors.push(error.message));
  await denied.goto(base);await denied.locator('#install-tip-dismiss').click();
  assert.ok(await denied.locator('#install-tip').isHidden());
  await denied.locator('#spin-button').click();
  await denied.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  assert.ok(await denied.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  pass('blocked local storage still permits dismissing the tip and playing, without an exception');
  await blocked.close();

  const manifest=await(await page.request.get(base+'manifest.webmanifest')).json();
  assert.equal(manifest.orientation,'portrait');
  const paths=[...manifest.icons.map(icon=>[icon.src,Number(icon.sizes.split('x')[0])]),['./icons/who-goes-first-large-32.png',32],['./icons/who-goes-first-large-apple-180.png',180]];
  for(const[path,size]of paths){
    const response=await page.request.get(new URL(path,base).href);
    assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);
    const data=await response.body();
    const info=await page.evaluate(async encoded=>{
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,image.width,image.height).data;
      let transparent=0;
      for(let i=3;i<pixels.length;i+=4)if(pixels[i]!==255)transparent++;
      const corners=[0,image.width-1,(image.height-1)*image.width,image.width*image.height-1].map(index=>[...pixels.slice(index*4,index*4+4)]);
      return {width:image.width,height:image.height,transparent,corners};
    },data.toString('base64'));
    assert.equal(info.width,size);assert.equal(info.height,size);assert.equal(info.transparent,0);
    for(const[r,g,b]of info.corners)assert.ok(r>g&&g>b&&r<255,'all corners retain gold, without white/transparent rounding');
  }
  assert.ok(manifest.icons.some(icon=>icon.purpose==='maskable'));
  const enlarged=await readFile(resolve(root,'icons/who-goes-first-large-maskable-512.png'));
  const original=await readFile(resolve(root,'icons/who-goes-first-maskable-512.png'));
  const footprint=await page.evaluate(async sources=>{
    const results=[];
    for(const encoded of sources){
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const c=document.createElement('canvas');c.width=image.width;c.height=image.height;
      const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
      const p=ctx.getImageData(0,0,c.width,c.height).data,seen=new Uint8Array(c.width*c.height),words=[];
      const dark=i=>p[i*4]<150&&p[i*4+1]<90&&p[i*4+2]<60&&p[i*4]-p[i*4+1]>20;
      for(let i=0;i<seen.length;i++){
        if(seen[i]||!dark(i))continue;
        const queue=[i];seen[i]=1;
        for(let j=0;j<queue.length;j++){
          const k=queue[j],x=k%c.width,y=Math.floor(k/c.width);
          for(const n of [x>0?k-1:-1,x<c.width-1?k+1:-1,y>0?k-c.width:-1,y<c.height-1?k+c.width:-1]){
            if(n>=0&&!seen[n]&&dark(n)){seen[n]=1;queue.push(n);}
          }
        }
        if(queue.length>1500)words.push(queue);
      }
      const points=words.flat();
      let left=c.width,right=0,top=c.height,bottom=0,radius=0;
      for(const i of points){
        left=Math.min(left,i%c.width);right=Math.max(right,i%c.width);
        top=Math.min(top,Math.floor(i/c.width));bottom=Math.max(bottom,Math.floor(i/c.width));
        radius=Math.max(radius,Math.hypot(i%c.width-c.width/2,Math.floor(i/c.width)-c.height/2));
      }
      results.push({outlineGroups:words.length,width:right-left,height:bottom-top,radius});
    }
    return results;
  },[original.toString('base64'),enlarged.toString('base64')]);
  // At 512px two neighbouring source-word outlines touch in both versions.
  // Preserve that topology; source generation separately requires three words.
  assert.equal(footprint[1].outlineGroups,footprint[0].outlineGroups);
  assert.ok(footprint[1].width/footprint[0].width>=1.19,'essential lettering is at least 19% larger, not a filename-only icon change');
  assert.ok(footprint[1].height/footprint[0].height>=1.19,'all three lines expand together without losing the top/bottom words');
  assert.ok(footprint[1].radius<512*.4,'all three word outlines remain inside the circular mask safe zone');
  const comparison=await page.evaluate(async sources=>{
    const canvas=document.createElement('canvas');canvas.width=900;canvas.height=600;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#f3ead8';ctx.fillRect(0,0,900,600);
    ctx.fillStyle='#49321c';ctx.font='bold 24px sans-serif';
    for(let i=0;i<sources.length;i++){
      const image=new Image();image.src=`data:image/png;base64,${sources[i]}`;await image.decode();
      const x=50+i*450;ctx.fillText(i?'Larger lettering':'Previous icon',x,40);
      ctx.drawImage(image,x,60,350,350);ctx.drawImage(image,x,450,96,96);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  },[original.toString('base64'),enlarged.toString('base64')]);
  await writeFile(resolve(root,'test-results/icon-lettering-comparison.png'),Buffer.from(comparison,'base64'));
  await writeFile(resolve(root,'test-results/icon-footprint.json'),JSON.stringify(footprint,null,2)+'\n');
  pass('maskable title is measurably larger while every essential word outline stays inside the circular safe zone');
  assert.equal(await page.locator('link[rel=apple-touch-icon]').getAttribute('href'),'./icons/who-goes-first-large-apple-180.png');
  const cdp=await context.newCDPSession(page);assert.deepEqual((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors,[]);
  pass('new manifest, Apple and browser icons decode at declared square sizes with opaque gold corners and no installability errors');
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  await context.setOffline(true);await page.reload();
  assert.ok(await page.locator('#install-tip').isHidden());
  for(const[path]of paths){const response=await page.request.get(new URL(path,base).href).catch(()=>null);if(response)assert.equal(response.status(),200);}
  const offlineIcons=await page.evaluate(async paths=>{
    for(const[path]of paths){const image=new Image();image.src=path;await image.decode();}
    return true;
  },paths);
  assert.ok(offlineIcons);
  assert.deepEqual(errors,[]);
  pass('installed assets and dismissed state remain available after a real offline reload');
  await context.close();
  await writeFile(resolve(root,'test-results/install-results.json'),JSON.stringify({checks,errors,limits:['Standalone detection and resize requests exercised; actual macOS install, Dock refresh and OS privacy notification remain device/browser responsibilities.']},null,2)+'\n');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}