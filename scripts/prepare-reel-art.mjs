// Import a hash-verified redraw without changing the original screenshot assets.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const hash=data=>createHash('sha256').update(data).digest('hex');
const source=await readFile(resolve(root,'assets/reel-redraw-source.png'));
if(hash(source)!=='319db8b76d7cc217b321f04c5c62411cf320fe9efea369e4802f28df547a4e13')throw new Error('Unexpected redraw source');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  const result=await page.evaluate(async encoded=>{
    const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
    const src=document.createElement('canvas');src.width=1024;src.height=1024;
    const ctx=src.getContext('2d');ctx.drawImage(image,0,0);
    const pixels=ctx.getImageData(0,0,1024,1024);
    for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=Math.max(0,Math.min(255,(pixels.data[i]-80)*255/140));
    ctx.putImageData(pixels,0,0);
    const art=document.createElement('canvas');art.width=1170;art.height=1064;
    const target=art.getContext('2d');
    // Register the redrawn blank window to the original 585x532 coordinates.
    // Separate border bands avoid changing the aperture or arrow selection line.
    const xs=[6,60,964,1018],xd=[0,40,1120,1170];
    const ys=[99,222,501,800,924],yd=[0,136,546,928,1064];
    for(let y=0;y<ys.length-1;y++)for(let x=0;x<3;x++)target.drawImage(src,xs[x],ys[y],xs[x+1]-xs[x],ys[y+1]-ys[y],xd[x],yd[y],xd[x+1]-xd[x],yd[y+1]-yd[y]);
    const paper=document.createElement('canvas');paper.width=960;paper.height=600;
    paper.getContext('2d').drawImage(art,80,190,960,600,0,0,960,600);
    return {art:art.toDataURL('image/png').split(',')[1],paper:paper.toDataURL('image/png').split(',')[1]};
  },source.toString('base64'));
  const outputs={};
  for(const[file,encoded]of [['reel-redrawn.png',result.art],['parchment-redrawn.png',result.paper]]){
    const bytes=Buffer.from(encoded,'base64');await writeFile(resolve(root,'assets',file),bytes);outputs[file]=hash(bytes);
  }
  await writeFile(resolve(root,'assets/reel-redraw-receipt.json'),JSON.stringify({
    request:'wgf-reel-redraw-01',model:'gpt-image-2.5-flare',source:hash(source),
    reference:'b0e7f17d692507870ef61af06d9df8ed195dd2598c3fab979e4c4ebea6e6f922',
    method:'Reference-guided redraw of original ornament, parchment, bevel and inward markers. Low-alpha fringe removed; border bands registered to original live-name geometry at 2x. Original source plate, machine crop, approved buttons and audio retained unchanged.',
    dimensions:{width:1170,height:1064},outputs
  },null,2)+'\n');
}finally{await browser.close();}