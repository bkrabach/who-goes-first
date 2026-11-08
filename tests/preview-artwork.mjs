// Exercise the actual bundled artwork, not just spinner behavior or source URLs.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url));
const html=await readFile(resolve(root,'test-results/preview.html'),'utf8');
assert.ok(Buffer.byteLength(html)<20_000_000,'Full-quality preview must fit Canvas');
const policy="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const probe='<script>window.artViolations=[];addEventListener("securitypolicyviolation",e=>artViolations.push(e.violatedDirective));</script>';
const browser=await chromium.launch({headless:true});
const checks=[],errors=[];
try{
  const page=await browser.newPage({viewport:{width:800,height:1100},reducedMotion:'reduce'});
  page.on('pageerror',error=>errors.push(error.message));
  await page.setContent('<iframe id="preview" sandbox="allow-scripts allow-modals" style="width:640px;height:960px;border:0"></iframe>');
  await page.locator('#preview').evaluate((iframe,body)=>{iframe.srcdoc=body;},html.replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${policy}">${probe}`));
  const app=page.frameLocator('#preview');
  await app.locator('.selected').waitFor();
  const frame=page.frames().find(frame=>frame.parentFrame());
  const layers=[
    ['body','shell-gold.png',1024,1024],
    ['.machine','reel-redrawn.png',1170,1064],
    ['#settings-open','shell-gold.png',1024,1024],
    ['#manage-top','shell-gold.png',1024,1024],
    ['#spin-button','shell-gold.png',1024,1024],
    ['#settings-dialog','parchment-redrawn.png',960,600]
  ];
  for(const[selector,file,width,height]of layers){
    const expected=(await readFile(resolve(root,'assets',file))).toString('base64');
    const evidence=await frame.evaluate(async({selector,expected})=>{
      const background=getComputedStyle(document.querySelector(selector)).backgroundImage;
      const url=background.match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if(!url)return {background};
      async function pixels(src){
        const image=new Image();image.src=src;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        canvas.getContext('2d').drawImage(image,0,0);
        return {width:image.width,height:image.height,data:canvas.getContext('2d').getImageData(0,0,image.width,image.height).data};
      }
      const actual=await pixels(url),reference=await pixels(`data:image/png;base64,${expected}`);
      let different=0;
      for(let i=0;i<reference.data.length;i++)if(actual.data[i]!==reference.data[i])different++;
      return {width:actual.width,height:actual.height,different};
    },{selector,expected});
    assert.equal(evidence.width,width,`${selector}: background must resolve and decode`);
    assert.equal(evidence.height,height,`${selector}: expected full-resolution artwork`);
    assert.equal(evidence.different,0,`${selector}: preview must preserve exact artwork pixels`);
  }
  checks.push('all six artwork layers resolve, decode, and match full-resolution source pixels in the no-network sandbox');
  await app.locator('#reel-track').evaluate(node=>{node.style.visibility='hidden';});
  const machine=app.locator('.machine');
  const visible=await machine.screenshot();
  await machine.evaluate(node=>{node.style.backgroundImage='none';});
  const missing=await machine.screenshot();
  assert.notDeepEqual(visible,missing,'The reel artwork must actually affect rendered pixels');
  await machine.evaluate(node=>{node.style.backgroundImage='';});
  await app.locator('#reel-track').evaluate(node=>{node.style.visibility='';});
  await app.locator('.original-screen').screenshot({path:resolve(root,'test-results/preview-artwork-restored.png')});
  checks.push('parchment, ornament, and selection markers paint rather than leaving floating names');
  await app.locator('#settings-open').click();
  await app.locator('#settings-dialog').screenshot({path:resolve(root,'test-results/preview-artwork-settings.png')});
  assert.deepEqual(await frame.evaluate(()=>artViolations),[]);
  assert.deepEqual(errors,[]);
  checks.push('embedded artwork needs no fetch, policy relaxation, or opaque-origin exception');
  await writeFile(resolve(root,'test-results/preview-artwork-results.json'),JSON.stringify({checks,errors,previewBytes:Buffer.byteLength(html)},null,2)+'\n');
  for(const check of checks)console.log(`PASS ${check}`);
}finally{await browser.close();}