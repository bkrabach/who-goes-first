import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from '../scripts/serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../',import.meta.url));
const server = createStaticServer(resolve(root,'dist'));
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({headless:true,args:['--autoplay-policy=user-gesture-required']});
const checks = [], errors = [];
const pass = check => {checks.push(check); console.log(`PASS ${check}`);};
try {
  const context = await browser.newContext({reducedMotion:'no-preference'});
  // Instrument the real Web Audio graph, not a fake player. The analyser reads
  // actual decoded PCM output; no assertion of physical speaker audibility.
  await context.addInitScript(() => {
    window.audioEvidence = {decoded:0,events:[],maxSignal:0,wheelSignal:0};
    const decode = AudioContext.prototype.decodeAudioData;
    AudioContext.prototype.decodeAudioData = function(...args) {
      const result = decode.apply(this,args);
      result.then(buffer => {
        if (buffer.duration > .1) window.audioEvidence.decoded++;
      }).catch(() => {});
      return result;
    };
    const animate = Element.prototype.animate;
    Element.prototype.animate = function(...args) {
      const result = animate.apply(this,args);
      if (this.id === 'reel-track') result.finished.then(() => {
        window.audioEvidence.events.push({type:'land',time:performance.now()});
      }).catch(() => {});
      return result;
    };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args) {
      if (this.buffer?.duration > .1 && this.context instanceof AudioContext) {
        const type = this.buffer.duration > 2 ? 'wheel' : 'yay';
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        this.connect(analyser);
        // Connect through zero gain so the analyser's branch is pulled without
        // duplicating the audible app output.
        const muted = this.context.createGain();
        muted.gain.value = 0;
        analyser.connect(muted);
        muted.connect(this.context.destination);
        window.audioEvidence.events.push({
          type,time:performance.now(),duration:this.buffer.duration,
          winner:document.querySelector('#result').textContent,
          center:document.querySelector('.selected')?.textContent,
          state:this.context.state,
          spinning:document.querySelector('#machine').classList.contains('is-spinning'),
          animationTime:document.querySelector('#reel-track').getAnimations()[0]?.currentTime
        });
        const until = performance.now()+this.buffer.duration*1000+100;
        const samples = new Float32Array(analyser.fftSize);
        const sample = () => {
          analyser.getFloatTimeDomainData(samples);
          const field = type === 'wheel' ? 'wheelSignal' : 'maxSignal';
          for (const value of samples) window.audioEvidence[field] = Math.max(window.audioEvidence[field],Math.abs(value));
          if (performance.now() < until) requestAnimationFrame(sample);
          else { analyser.disconnect(); muted.disconnect(); }
        };
        requestAnimationFrame(sample);
        this.addEventListener('ended',()=>window.audioEvidence.events.push({type:`${type}-ended`,time:performance.now()}));
      }
      return start.apply(this,args);
    };
  });
  const page = await context.newPage();
  page.on('pageerror',error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => window.audioEvidence.decoded === 2);
  assert.equal(await page.evaluate(() => window.audioEvidence.events.length),0);
  pass('both real WAV clips decode before play; loading the app produces no sound');
  await page.locator('#spin-button').click();
  assert.equal(await page.evaluate(() => window.audioEvidence.events.filter(e=>e.type==='yay').length),0);
  await page.waitForFunction(() => window.audioEvidence.maxSignal > .02);
  await page.waitForFunction(() => window.audioEvidence.events.some(event=>event.type==='land'));
  const evidence = await page.evaluate(() => window.audioEvidence);
  const landing = evidence.events.find(e=>e.type==='land');
  const yay = evidence.events.find(e=>e.type==='yay');
  const delay = yay.time-landing.time;
  assert.ok(delay >= 0 && delay < 50, `Expected no timing offset, observed ${delay}ms delay`);
  assert.equal(yay.winner,`${yay.center} goes first!`);
  assert.equal(yay.spinning,true);
  assert.equal(yay.state,'running');
  assert.equal(await page.locator('#result').textContent(),`${await page.locator('.selected').textContent()} goes first!`);
  assert.ok(yay.duration > .9 && yay.duration < 1.1);
  assert.equal(evidence.events.filter(e=>e.type==='yay').length,1);
  pass(`one non-silent Yay starts at landing (${Math.round(delay)}ms callback delay), with no early cue`);
  const wheel = evidence.events.find(e=>e.type==='wheel');
  assert.ok(wheel);
  assert.ok((wheel.animationTime || 0) < 150);
  assert.ok(evidence.wheelSignal > .02);
  assert.equal(wheel.duration,3.2);
  await page.waitForFunction(()=>window.audioEvidence.events.some(e=>e.type==='wheel-ended'));
  const wheelEnd = await page.evaluate(()=>window.audioEvidence.events.find(e=>e.type==='wheel-ended'));
  assert.ok(Math.abs(wheelEnd.time-landing.time) < 150);
  pass('wheel audio starts with the reel and stops at landing as the Yay begins');
  const mix = await page.evaluate(async base => {
    const context=new OfflineAudioContext(2,Math.ceil(4.3*44100),44100);
    const decode=async path=>context.decodeAudioData(await (await fetch(base+path)).arrayBuffer());
    const wheel=context.createBufferSource();wheel.buffer=await decode('/assets/wheel-spin.wav');
    const yay=context.createBufferSource();yay.buffer=await decode('/assets/yay-third.wav');
    const gain=context.createGain();gain.gain.value=.55;
    wheel.connect(gain);gain.connect(context.destination);yay.connect(context.destination);
    wheel.start(0);yay.start(3.2);
    const output=await context.startRendering();
    let peak=0;
    for(let c=0;c<output.numberOfChannels;c++)for(const value of output.getChannelData(c))peak=Math.max(peak,Math.abs(value));
    return peak;
  },base);
  assert.ok(mix>.1&&mix<1);
  pass('combined wheel and Yay output has headroom with no PCM clipping');

  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => window.audioEvidence.events.filter(e=>e.type==='yay').length===2);
  const short = await page.evaluate(() => {
    const yay=window.audioEvidence.events.filter(e=>e.type==='yay').at(-1);
    const land=window.audioEvidence.events.filter(e=>e.type==='land').at(-1);
    return {delta:yay.time-land.time,winner:yay.winner,center:yay.center};
  });
  assert.ok(short.delta >= 0 && short.delta < 50);
  assert.equal(short.winner,`${short.center} goes first!`);
  assert.equal(await page.evaluate(()=>window.audioEvidence.events.filter(e=>e.type==='wheel').length),1);
  pass('reduced-motion spins also play the cue once at landing');
  await page.locator('#settings-open').click();
  await page.getByRole('button',{name:'Sound credits',exact:true}).click();
  assert.equal(await page.locator('#credits-dialog a').first().getAttribute('href'),'https://freesound.org/s/61691/');
  assert.match(await page.locator('#credits-dialog').textContent(),/IFartInUrGeneralDirection/);
  assert.equal(await page.locator('#credits-dialog a').nth(1).getAttribute('href'),'https://creativecommons.org/licenses/by/4.0/');
  assert.equal(await page.locator('#credits-dialog a').nth(2).getAttribute('href'),'https://freesound.org/s/79073/');
  assert.equal(await page.locator('#credits-dialog a').last().getAttribute('href'),'https://creativecommons.org/licenses/sampling+/1.0/');
  assert.match(await page.locator('#credits-dialog').textContent(),/plivesey/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  pass('Sound credits retains the author, source, license link, and editing disclosure');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));
  });
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.audioEvidence.decoded===2);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#spin-button').click();
  await page.waitForFunction(() => window.audioEvidence.maxSignal>.02);
  assert.ok(await page.evaluate(()=>window.audioEvidence.wheelSignal>.02));
  await page.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
  pass('offline reload decodes the cached clip and produces non-silent winner audio');
  await context.setOffline(false);

  const preview = await context.newPage();
  await preview.goto(`file://${resolve(root,'test-results/preview.html')}`);
  await preview.waitForFunction(() => window.audioEvidence.decoded===2);
  await preview.locator('#spin-button').click();
  await preview.waitForFunction(() => window.audioEvidence.maxSignal>.02);
  assert.ok(await preview.evaluate(()=>window.audioEvidence.wheelSignal>.02));
  pass('single-file preview embeds and plays the same non-silent clip');
  await preview.close();

  const wav = await (await page.request.get(`${base}/assets/yay-third.wav`)).body();
  assert.equal((await page.request.get(`${base}/assets/yay-third.wav`)).headers()['content-type'],'audio/wav');
  const receipt = JSON.parse(await readFile(resolve(root,'assets/yay-third-receipt.json'),'utf8'));
  if (process.env.YAY_SOURCE) {
    const source = await readFile(process.env.YAY_SOURCE);
    const match = await page.evaluate(async ({source,clip,receipt}) => {
      const decoder = new OfflineAudioContext(2,1,44100);
      const bytes = s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer;
      const original = await decoder.decodeAudioData(bytes(source));
      const output = await decoder.decodeAudioData(bytes(clip));
      const pcm = new DataView(bytes(clip));
      let maxDifference=0;
      const fade = Math.round(receipt.sampleRate*.005);
      for(let channel=0;channel<2;channel++) {
        const a=original.getChannelData(channel),b=output.getChannelData(channel);
        for(let i=0;i<b.length;i++) {
          const gain=Math.min(1,i/fade,(b.length-1-i)/fade);
          const expected=Math.round(Math.max(-1,Math.min(1,a[receipt.startSample+i]*gain))*32767);
          const actual=pcm.getInt16(44+(i*2+channel)*2,true);
          maxDifference=Math.max(maxDifference,Math.abs(expected-actual));
        }
      }
      return {maxDifference,length:output.length,duration:output.duration};
    },{source:source.toString('base64'),clip:wav.toString('base64'),receipt});
    assert.equal(match.maxDifference,0);
    pass('every trimmed WAV sample exactly matches the third phrase of the supplied MP3, with documented edge fades');
  }
  assert.deepEqual(errors,[]);
  pass('no uncaught browser audio errors');
  await context.close();
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  await writeFile(resolve(root,'test-results/audio-browser-results.json'),JSON.stringify({checks,errors},null,2)+'\n');
}