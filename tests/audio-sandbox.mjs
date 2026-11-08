// Canvas-style regression: opaque-origin, script-enabled srcdoc, no fetch.
// This intentionally does not relax CSP or grant a same-origin sandbox.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../',import.meta.url));
const html = await readFile(resolve(root,'test-results/preview.html'),'utf8');
const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const instrumentation = `<script>
  window.sandboxAudio = {decoded:0,cues:0,wheels:0,maxSignal:0,violations:[]};
  addEventListener('securitypolicyviolation', event => sandboxAudio.violations.push(event.violatedDirective));
  const decode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function(...args) {
    const pending = decode.apply(this,args);
    pending.then(buffer => { if(buffer.duration > .1) sandboxAudio.decoded++; }).catch(()=>{});
    return pending;
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
    if (this.buffer?.duration > .1) {
      if (this.buffer.duration>2) sandboxAudio.wheels++;
      else sandboxAudio.cues++;
      const analyser = this.context.createAnalyser();
      const gain = this.context.createGain();
      gain.gain.value=0;
      this.connect(analyser);
      analyser.connect(gain);
      gain.connect(this.context.destination);
      const samples=new Float32Array(analyser.fftSize);
      const until=performance.now()+1200;
      const read=()=>{
        analyser.getFloatTimeDomainData(samples);
        for(const value of samples) sandboxAudio.maxSignal=Math.max(sandboxAudio.maxSignal,Math.abs(value));
        if(performance.now()<until) requestAnimationFrame(read);
        else {analyser.disconnect();gain.disconnect();}
      };
      requestAnimationFrame(read);
    }
    return start.apply(this,args);
  };
</script>`;
const embedded = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">${instrumentation}`);
const browser = await chromium.launch({headless:true,args:['--autoplay-policy=user-gesture-required']});
const checks = [];
try {
  const page = await browser.newPage({viewport:{width:800,height:1100}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<iframe id="preview" sandbox="allow-scripts allow-modals" style="width:640px;height:960px;border:0"></iframe>');
  await page.locator('#preview').evaluate((frame,body)=>{frame.srcdoc=body;},embedded);
  const iframe=page.frameLocator('#preview');
  await iframe.locator('#spin-button').waitFor();
  const frame = page.frames().find(frame=>frame.parentFrame());
    await frame.waitForFunction(()=>sandboxAudio.decoded === 2 || sandboxAudio.violations.length > 0);
  const initial=await frame.evaluate(()=>sandboxAudio);
  if(process.argv.includes('--diagnose')) {
    console.log(JSON.stringify(initial,null,2));
    await writeFile(resolve(root,'test-results/sandbox-audio-before.json'),JSON.stringify(initial,null,2)+'\n');
  } else {
    assert.equal(initial.decoded,2,'Both embedded clips must decode without fetch under connect-src none');
    assert.deepEqual(initial.violations,[]);
    checks.push('inline audio decodes inside an opaque-origin no-network CSP sandbox');
    await iframe.locator('#spin-button').click();
    await frame.waitForFunction(()=>sandboxAudio.maxSignal>.02);
    await frame.waitForFunction(()=>document.querySelector('#result').textContent.endsWith('goes first!'));
    assert.equal(await frame.evaluate(()=>sandboxAudio.cues),1);
    assert.equal(await frame.evaluate(()=>sandboxAudio.wheels),1);
    checks.push('real click produces non-silent winner audio inside the sandbox');
    await iframe.locator('#settings-open').click();
    await iframe.getByRole('button',{name:'Sound credits',exact:true}).click();
    await iframe.getByRole('button',{name:'Test sound',exact:true}).click();
    await frame.waitForFunction(()=>sandboxAudio.cues===2);
    checks.push('explicit Test sound works in the sandbox');
    assert.deepEqual(errors,[]);
    await writeFile(resolve(root,'test-results/sandbox-audio-results.json'),JSON.stringify({checks,evidence:await frame.evaluate(()=>sandboxAudio),errors},null,2)+'\n');
    for(const check of checks)console.log(`PASS ${check}`);
  }
} finally {await browser.close();}