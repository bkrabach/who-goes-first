import { mkdir, readFile, writeFile, rename, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const stage = await mkdtemp(resolve(root,'.dist-stage-'));
const files = ['index.html', 'styles.css', 'app.js', 'logic.js', 'audio.js', 'motion.js', 'gestures.js', 'settings.js', 'install.js', 'manifest.webmanifest', '_headers', 'RELEASE.txt'];
const assets = ['main-screen.png','gold-texture.png','shell-gold.png','workbench-illustrated.png','device-patina.png','artifact-surface-receipt.json','artwork-receipt.json','machine-frame.png','reel-redrawn.png','parchment-redrawn.png','reel-redraw-receipt.json','players-label.png','spin-label.png','parchment-texture.png','yay-third.wav','yay-third-receipt.json','wheel-spin.wav','wheel-spin-receipt.json','audio-attribution.txt'];
const icons = ['who-goes-first-large-32.png','who-goes-first-large-192.png','who-goes-first-large-512.png','who-goes-first-large-1024.png','who-goes-first-large-maskable-512.png','who-goes-first-large-apple-180.png','icon-large-receipt.json'];
const hashes = {};
for (const file of [...files,...assets.map(file=>`assets/${file}`),...icons.map(file=>`icons/${file}`)]) {
  const body = await readFile(resolve(root, file));
  hashes[file] = createHash('sha256').update(body).digest('hex');
  await mkdir(resolve(stage,file,'..'),{recursive:true});
  await writeFile(resolve(stage, file), body);
}
const workerSource = await readFile(resolve(root, 'sw.js'), 'utf8');
hashes['sw.js'] = createHash('sha256').update(workerSource).digest('hex');
const version = createHash('sha256').update(JSON.stringify(hashes)).digest('hex').slice(0, 12);
const worker = workerSource.replace("PREFIX + 'v1'", `PREFIX + '${version}'`);
await writeFile(resolve(stage, 'sw.js'), worker);
const outputs={...hashes,'sw.js':createHash('sha256').update(worker).digest('hex')};
await writeFile(resolve(stage, 'build-info.json'), JSON.stringify({ version, files: hashes, outputs }, null, 2) + '\n');
// Verify every staged output before switching. Keep the previous generated
// directory intact, rather than deleting anything from a caller's workspace.
for(const[file,hash]of Object.entries(outputs)){
  if(createHash('sha256').update(await readFile(resolve(stage,file))).digest('hex')!==hash)throw new Error(`Build verification failed: ${file}`);
}
try { await rename(dist,resolve(root,`.dist-previous-${Date.now()}`)); }
catch(error){if(error.code!=='ENOENT')throw error;}
await rename(stage,dist);
console.log(`Built static PWA in dist/ (${version}). Deploy dist/ to an HTTPS static host.`);