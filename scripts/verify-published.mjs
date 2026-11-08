// Compare direct HTTPS responses against a trusted local/Actions build receipt.
// PUBLISHED_URL=https://owner.github.io/repo/ node scripts/verify-published.mjs
// VERIFIED_BUILD_INFO=/path/to/Actions/dist/build-info.json selects another
// trusted receipt. A downloaded remote receipt is never its own trust anchor.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
if(!process.env.PUBLISHED_URL)throw new Error('Set PUBLISHED_URL to the approved HTTPS site URL.');
const base=new URL(process.env.PUBLISHED_URL);
if(base.protocol!=='https:' || base.username || base.password || base.search || base.hash || !base.pathname.endsWith('/'))throw new Error('Expected an HTTPS directory URL ending with /, without credentials, query, or fragment.');
const local=JSON.parse(await readFile(process.env.VERIFIED_BUILD_INFO || resolve(root,'dist/build-info.json'),'utf8'));
async function download(path){
  const response=await fetch(new URL(path,base),{cache:'no-store',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);
  const target=new URL(response.url);
  if(target.origin!==base.origin || !target.pathname.startsWith(base.pathname))throw new Error(`Unexpected redirect for ${path}`);
  return Buffer.from(await response.arrayBuffer());
}
const info=JSON.parse((await download('build-info.json')).toString('utf8'));
if(info.version!==local.version)throw new Error(`Published build ${info.version} differs from trusted build ${local.version}`);
const checked=[];
for(const[file,expected]of Object.entries(local.outputs)){
  if(file.startsWith('/') || file.includes('..') || file.includes('\\') || file.includes(':'))throw new Error('Unsafe receipt path');
  const bytes=await download(file);
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==expected)throw new Error(`Published bytes differ for ${file}: ${actual}`);
  checked.push({file,bytes:bytes.length,sha256:actual});
  console.log(`MATCH ${file}`);
}
await mkdir(resolve(root,'test-results'),{recursive:true});
await writeFile(resolve(root,'test-results/published-verification.json'),JSON.stringify({
  url:base.href,build:local.version,checked,checks:['Direct HTTPS fetches bypass service workers','Published release matches trusted build output hashes']
},null,2)+'\n');
console.log(`Verified ${checked.length} published files at ${base.href} (build ${local.version}).`);