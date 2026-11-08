// Derive alpha-matted responsive artwork; preserve the original source plate.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const plate=await readFile(resolve(root,'assets/main-screen.png'));
const goldPath=process.env.GOLD_TEXTURE||resolve(root,'assets/gold-material-source.png');
const gold=await readFile(resolve(goldPath));
if(gold&&createHash('sha256').update(gold).digest('hex')!=='4aea1898393deab0f5603a64c574eb4242687d6b245a28981f432fc4040ae9f3')throw new Error('Unexpected gold texture');
const receipt=JSON.parse(await readFile(resolve(root,'assets/artwork-receipt.json'),'utf8'));
if(createHash('sha256').update(plate).digest('hex')!==receipt.outputs['main-screen.png'])throw new Error('Restored plate changed');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();
  const crops={
    'machine-frame.png':[29,90,585,532],
    'players-button.png':[396,11,216,72],
    'spin-button.png':[54,672,536,197],
    'parchment-texture.png':[80,190,480,300]
  };
  const outputs=await page.evaluate(async({encoded,crops,gold})=>{
    const image=new Image();image.src=`data:image/png;base64,${encoded}`;await image.decode();
    const result={};
    for(const[file,[x,y,w,h]]of Object.entries(crops)){
      const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
      canvas.getContext('2d').drawImage(image,x,y,w,h,0,0,w,h);
      if(file==='machine-frame.png'){
        const ctx=canvas.getContext('2d');
        ctx.globalCompositeOperation='destination-in';
        ctx.beginPath();ctx.roundRect(1,1,w-2,h-3,16);ctx.fill();
      }
      result[file]=canvas.toDataURL('image/png').split(',')[1];
    }
    // Separate original lettering from its old background. Cream faces and
    // dark, warm outlines form a distinct colour key from the ochre material.
    for(const[file,[x,y,w,h]]of Object.entries({
      'players-label-extracted.png':[427,16,148,49],
      'spin-label-extracted.png':[70,706,502,122]
    })){
      const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.drawImage(image,x,y,w,h,0,0,w,h);
      const data=ctx.getImageData(0,0,w,h),mask=new Uint8Array(w*h);
      for(let i=0;i<mask.length;i++){
        const[r,g,b]=data.data.slice(i*4,i*4+3);
        mask[i]=b>Math.max(42,g*.43)&&r>150?1:0;
      }
      // Discard isolated patina specks, not dots or punctuation in the label.
      const visited=new Uint8Array(mask.length);
      for(let i=0;i<mask.length;i++){
        if(!mask[i]||visited[i])continue;
        const component=[],pending=[i];visited[i]=1;
        while(pending.length){
          const j=pending.pop();component.push(j);
          for(const k of [j%w?j-1:-1,j%w<w-1?j+1:-1,j-w,j+w]){
            if(k>=0&&k<mask.length&&mask[k]&&!visited[k]){visited[k]=1;pending.push(k);}
          }
        }
        const xs=component.map(j=>j%w),ys=component.map(j=>Math.floor(j/w));
        const cw=Math.max(...xs)-Math.min(...xs)+1,ch=Math.max(...ys)-Math.min(...ys)+1;
        if(component.length<8||ch<3||cw/ch>7)for(const j of component)mask[j]=0;
      }
      const radius=file==='players-label-extracted.png'?3:5;
      const expanded=new Uint8Array(mask.length);
      for(let i=0;i<mask.length;i++)if(mask[i]){
        const x=i%w,y=Math.floor(i/w);
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
          if(dx*dx+dy*dy>radius*radius)continue;
          if(x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)expanded[(y+dy)*w+x+dx]=1;
        }
      }
      for(let i=0;i<mask.length;i++){
        const[r,g,b]=data.data.slice(i*4,i*4+3);
        const isLetter=(b>g*.43&&r>125)||(r<160&&g<r*.57);
        data.data[i*4+3]=expanded[i]&&isLetter?255:0;
      }
      ctx.putImageData(data,0,0);
      result[file]=c.toDataURL('image/png').split(',')[1];
    }
    // Mirror a border-free gold patch on both axes. Opposite edges then match,
    // avoiding the horizontal seams of repeating a narrow screenshot strip.
    const patch=document.createElement('canvas');patch.width=256;patch.height=64;
    let texture=image;
    if(gold){texture=new Image();texture.src=`data:image/png;base64,${gold}`;await texture.decode();}
    patch.width=512;patch.height=512;
    patch.getContext('2d').drawImage(texture,...(gold?[0,0,1024,1024]:[8,8,360,64]),0,0,512,512);
    const tile=document.createElement('canvas');tile.width=1024;tile.height=1024;
    const ctx=tile.getContext('2d');
    for(const [x,y,sx,sy]of [[0,0,1,1],[1024,0,-1,1],[0,1024,1,-1],[1024,1024,-1,-1]]){
      ctx.save();ctx.translate(x,y);ctx.scale(sx,sy);ctx.drawImage(patch,0,0);ctx.restore();
    }
    result['shell-gold.png']=tile.toDataURL('image/png').split(',')[1];
    return result;
  },{encoded:plate.toString('base64'),crops,gold:gold?.toString('base64')});
  for(const[file,data]of Object.entries(outputs)){
    await writeFile(resolve(root,'assets',file),Buffer.from(data,'base64'));
    console.log(`Prepared ${file}`);
  }
  await writeFile(resolve(root,'assets/responsive-art-receipt.json'),JSON.stringify({
    originalPlate:receipt.outputs['main-screen.png'],
    goldMaterial:{sha256:createHash('sha256').update(gold).digest('hex'),method:'Generated 1024px flat ochre material; mirrored seamless tiling. Image generation request wgf-gold-paper-tile-01, gpt-image-2.5-flare. No original ornamental artwork replaced.'},
    method:'Original machine crop with alpha-rounded corners; original label faces and outlines colour-keyed into separate alpha layers; vector/CSS bevels render independently of labels. Source plate retained unchanged.',
    outputs:Object.fromEntries(Object.entries(outputs).map(([file,data])=>[file,createHash('sha256').update(Buffer.from(data,'base64')).digest('hex')]))
  },null,2)+'\n');
}finally{await browser.close();}