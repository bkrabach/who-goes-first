// Verified import of the approved working raster outputs. Originals are retained.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const inputs=[
  {source:'../working-files/artifact-workbench-stylized/ancient-workbench-painted-seamless-v2-1024.png',output:'assets/workbench-illustrated.png',sha256:'8cbd95d426b252923670d8a4f020f231a2430a6ef76bfe7f5a3d2287746a07fd',width:1024,height:1024},
  {source:'../working-files/artifact-workbench-final/device-patina-1280x1840.png',output:'assets/device-patina.png',sha256:'725b5d9c37e015f6149b0f7aedbbb76f3a0239d75335570acfa6de0b3bc8094d',width:1280,height:1840}
];
const hash=body=>createHash('sha256').update(body).digest('hex');
for(const input of inputs){
  const body=await readFile(resolve(root,input.source));
  if(hash(body)!==input.sha256)throw new Error(`Changed source: ${input.source}`);
  if(body.readUInt32BE(16)!==input.width||body.readUInt32BE(20)!==input.height)throw new Error('Wrong image geometry');
  let existing;
  try{existing=await readFile(resolve(root,input.output));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing&&hash(existing)!==input.sha256)throw new Error(`Refusing changed output: ${input.output}`);
  if(!existing)await writeFile(resolve(root,input.output),body,{flag:'wx'});
  if(hash(await readFile(resolve(root,input.output)))!==input.sha256)throw new Error('Import hash mismatch');
}
const receipt={
  sources:inputs.map(({output,sha256,width,height})=>({output,sha256,width,height})),
  wood:{generationRequests:['wgf-workbench-painted-style-v1','wgf-workbench-painted-seam-repair-v2'],nativeResolution:1024,description:'Illustrated hand-painted seamless wood, same pixels as approved working master; not an upscale.'},
  patina:{description:'Non-repeating straight-alpha stains, rubbed areas and scratches, below controls and machine. Original artwork retained.'}
};
const output=resolve(root,'assets/artifact-surface-receipt.json'),text=JSON.stringify(receipt,null,2)+'\n';
let previous;
try{previous=await readFile(output,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
if(previous&&previous!==text)throw new Error('Refusing to overwrite changed receipt');
if(!previous)await writeFile(output,text,{flag:'wx'});
console.log('Imported verified illustrated wood and transparent patina; all source/output hashes match.');
