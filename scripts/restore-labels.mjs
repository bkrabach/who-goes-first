// Prepare inspected high-resolution restorations without modifying originals.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const sources={
  spin:{hash:'f029e319647dc27058eda1945c442818570b2378802e9bde8870b2fe42b1636c',request:'wgf-clean-spin-lettering-01'},
  players:{hash:'72bc28b20d8a8f9ad84e5abee3ca1bfe3b648d62ce2ad7cdce2115f786792322',request:'wgf-clean-players-lettering-01'}
};
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  const outputs={};
  for(const[name,source]of Object.entries(sources)){
    const bytes=await readFile(resolve(root,`assets/${name}-lettering-source.png`));
    if(createHash('sha256').update(bytes).digest('hex')!==source.hash)throw new Error('Restoration input changed');
    const output=await page.evaluate(async encoded=>{
      const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
      const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
      const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
      let x0=canvas.width,y0=canvas.height,x1=0,y1=0,transparent=0;
      for(let i=0;i<pixels.data.length;i+=4){
        // Remove the generated low-alpha aura and make letter faces opaque.
        const alpha=Math.max(0,Math.min(255,(pixels.data[i+3]-100)*255/130));
        pixels.data[i+3]=alpha;
        if(alpha>0){
          const x=i/4%canvas.width,y=Math.floor(i/4/canvas.width);
          x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);
        }else transparent++;
      }
      if(transparent<pixels.width*pixels.height/2)throw new Error('Expected true transparent lettering');
      ctx.putImageData(pixels,0,0);
      const cropped=document.createElement('canvas');cropped.width=x1-x0+9;cropped.height=y1-y0+9;
      cropped.getContext('2d').drawImage(canvas,x0,y0,x1-x0+1,y1-y0+1,4,4,x1-x0+1,y1-y0+1);
      return {png:cropped.toDataURL('image/png').split(',')[1],width:cropped.width,height:cropped.height};
    },bytes.toString('base64'));
    const data=Buffer.from(output.png,'base64'),file=`${name}-label.png`;
    await writeFile(resolve(root,'assets',file),data);
    outputs[file]={sha256:createHash('sha256').update(data).digest('hex'),width:output.width,height:output.height};
  }
  await writeFile(resolve(root,'assets/lettering-receipt.json'),JSON.stringify({
    sources,model:'gpt-image-2.5-flare',method:'Reference-guided restoration of the original lettering. Low-alpha aura removed; transparent labels cropped without stretching. Full original plate preserved.',outputs
  },null,2)+'\n');
}finally{await browser.close();}