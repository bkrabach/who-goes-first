// Development only: use an installed Playwright (or playwright-core) package.
// App users and static hosts need no Node or browser-automation dependency.
import { readFile,writeFile } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleName = process.env.PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(moduleName);
const root = fileURLToPath(new URL('../', import.meta.url));
const source=await readFile(resolve(root,'icons/original-icon-source.png'));
const sourceHash=createHash('sha256').update(source).digest('hex');
if(sourceHash!=='a2b8cf94a33fffdfbea677da2914a7cdcc9effaf496f9ac89d8304baa4329102')throw new Error('Icon restoration input changed');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const outputs={};
  for (const [file,size,maskable] of [
    ['who-goes-first-32.png',32],['who-goes-first-192.png',192],
    ['who-goes-first-512.png',512],['who-goes-first-1024.png',1024],
    ['who-goes-first-maskable-512.png',512,true],['who-goes-first-apple-180.png',180]
  ]) {
    const encoded=await page.evaluate(async({encoded,size,maskable})=>{
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d',{alpha:false});
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(maskable){
        // Fill every corner; keep the entire title inside the circular 40% safe
        // zone, leaving masks to Android rather than baking in rounded edges.
        const tile=document.createElement('canvas');tile.width=128;tile.height=128;
        tile.getContext('2d').drawImage(image,800,0,200,130,0,0,128,128);
        ctx.fillStyle=ctx.createPattern(tile,'repeat');ctx.fillRect(0,0,size,size);
        ctx.drawImage(image,size*.22,size*.22,size*.56,size*.56);
      }else ctx.drawImage(image,0,0,size,size);
      const pixels=ctx.getImageData(0,0,size,size).data;
      if(!pixels.every((value,index)=>index%4!==3||value===255))throw new Error('Icon must be fully opaque');
      return canvas.toDataURL('image/png').split(',')[1];
    },{encoded:source.toString('base64'),size,maskable:!!maskable});
    const bytes=Buffer.from(encoded,'base64');
    await writeFile(resolve(root,'icons',file),bytes);
    outputs[file]={size,sha256:createHash('sha256').update(bytes).digest('hex'),opaque:true,maskable:!!maskable};
    console.log(`${file}: ${size}×${size}`);
  }
  await writeFile(resolve(root,'icons/icon-receipt.json'),JSON.stringify({
    request:'wgf-original-icon-square-02',model:'gpt-image-2.5-flare',
    originalReference:'500d22ad77c120eac8023002f155ca414dd9884ff61a9bf980f255c5aa326da8',
    source:sourceHash,method:'Original stacked lettering restored on opaque edge-to-edge square gold, no baked corner radius. Maskable title placed within 40% circular safe zone.',outputs
  },null,2)+'\n');
} finally { await browser.close(); }