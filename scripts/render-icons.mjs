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
    ['who-goes-first-large-32.png',32],['who-goes-first-large-192.png',192],
    ['who-goes-first-large-512.png',512],['who-goes-first-large-1024.png',1024],
    ['who-goes-first-large-maskable-512.png',512,true],['who-goes-first-large-apple-180.png',180]
  ]) {
    const result=await page.evaluate(async({encoded,size,maskable})=>{
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const full=document.createElement('canvas');full.width=image.width;full.height=image.height;
      full.getContext('2d').drawImage(image,0,0);
      const rgba=full.getContext('2d').getImageData(0,0,image.width,image.height).data;
      // Find the three substantial, connected brown word outlines. Ignore tiny
      // texture flecks; include a generous edge allowance for antialias/shadow.
      const visited=new Uint8Array(image.width*image.height),words=[];
      const dark=index=>rgba[index*4]<150&&rgba[index*4+1]<90&&rgba[index*4+2]<60&&rgba[index*4]-rgba[index*4+1]>20;
      for(let index=0;index<visited.length;index++){
        if(visited[index]||!dark(index))continue;
        const queue=[index];visited[index]=1;
        for(let cursor=0;cursor<queue.length;cursor++){
          const pixel=queue[cursor],x=pixel%image.width,y=Math.floor(pixel/image.width);
          for(const neighbour of [x>0?pixel-1:-1,x<image.width-1?pixel+1:-1,y>0?pixel-image.width:-1,y<image.height-1?pixel+image.width:-1]){
            if(neighbour>=0&&!visited[neighbour]&&dark(neighbour)){visited[neighbour]=1;queue.push(neighbour);}
          }
        }
        if(queue.length>20000)words.push(queue);
      }
      if(words.length!==3)throw new Error('Expected three original word outlines');
      const points=words.flat();
      let left=Infinity,right=0,top=Infinity,bottom=0;
      for(const index of points){const x=index%image.width,y=Math.floor(index/image.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
      const cx=(left+right)/2,cy=(top+bottom)/2;
      let radius=0;
      for(const index of points)radius=Math.max(radius,Math.hypot(index%image.width-cx,Math.floor(index/image.width)-cy));
      radius+=10;
      const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext('2d',{alpha:false});
      ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
      if(maskable){
        // Fit the actual lettering, not the empty corners of its square image.
        // The essential title stays inside the circular 40% mask-safe zone.
        const tile=document.createElement('canvas');tile.width=128;tile.height=128;
        tile.getContext('2d').drawImage(image,800,0,200,130,0,0,128,128);
        ctx.fillStyle=ctx.createPattern(tile,'repeat');ctx.fillRect(0,0,size,size);
        const scale=size*.395/radius;
        ctx.drawImage(image,size/2-cx*scale,size/2-cy*scale,image.width*scale,image.height*scale);
      }else{
        const side=Math.max(right-left,bottom-top)+40;
        ctx.drawImage(image,cx-side/2,cy-side/2,side,side,0,0,size,size);
      }
      const pixels=ctx.getImageData(0,0,size,size).data;
      if(!pixels.every((value,index)=>index%4!==3||value===255))throw new Error('Icon must be fully opaque');
      return {encoded:canvas.toDataURL('image/png').split(',')[1],bounds:{left,right,top,bottom},maskableSourceScale:.395*image.width/radius};
    },{encoded:source.toString('base64'),size,maskable:!!maskable});
    const bytes=Buffer.from(result.encoded,'base64');
    await writeFile(resolve(root,'icons',file),bytes);
    outputs[file]={size,sha256:createHash('sha256').update(bytes).digest('hex'),opaque:true,maskable:!!maskable,letterBounds:result.bounds,maskableSourceScale:result.maskableSourceScale};
    console.log(`${file}: ${size}×${size}`);
  }
  await writeFile(resolve(root,'icons/icon-large-receipt.json'),JSON.stringify({
    request:'wgf-original-icon-square-02',model:'gpt-image-2.5-flare',
    originalReference:'500d22ad77c120eac8023002f155ca414dd9884ff61a9bf980f255c5aa326da8',
    source:sourceHash,method:'Original lettering retained. Any icons crop excess gold with 20px lettering margin; maskable icons center and fit actual three word outlines, including 10px edge allowance, inside a 39.5% circular safe zone instead of shrinking the full source square to 56%. Opaque square corners; OS applies its own mask.',outputs
  },null,2)+'\n');
} finally { await browser.close(); }