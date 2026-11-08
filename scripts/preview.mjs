// Package the real app as a single-file Canvas preview, not a second UI.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const files = ['index.html', 'styles.css', 'logic.js', 'audio.js', 'motion.js', 'settings.js', 'install.js', 'app.js'];
const sources = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(resolve(root, file), 'utf8')])));
const logic = sources['logic.js'].replace(/^export /gm, '');
const motion = sources['motion.js'].replace(/^export /gm, '');
const settings = sources['settings.js'].replace(/^export /gm, '');
const install = sources['install.js'].replace(/^export /gm, '');
const clip = await readFile(resolve(root, 'assets/yay-third.wav'));
const wheel = await readFile(resolve(root, 'assets/wheel-spin.wav'));
const audio = sources['audio.js'].replace(/^export /gm, '')
  .replace('./assets/yay-third.wav', `data:audio/wav;base64,${clip.toString('base64')}`)
  .replace('./assets/wheel-spin.wav', `data:audio/wav;base64,${wheel.toString('base64')}`);
const app = sources['app.js'].replace(/^import .*?;\n/gm, '');
const artFiles = ['assets/shell-gold.png','assets/reel-redrawn.png','assets/players-label.png','assets/spin-label.png','assets/parchment-redrawn.png','icons/who-goes-first-192.png'];
const art = Object.fromEntries(await Promise.all(artFiles.map(async file => [file, await readFile(resolve(root, file))])));
let css = sources['styles.css'];
const embeddedArt=[];
for (const [index,file] of artFiles.entries()) {
  const url=`url('./${file}')`;
  const variable=`--preview-art-${index}`;
  const background=css.includes(url);
  if(background)css=css.replaceAll(url,`var(${variable})`);
  embeddedArt.push({file,variable,background,bytes:art[file].toString('base64')});
}
// Large data URLs exceed Chromium's custom-property token limit and silently
// invalidate the whole background. Keep CSS values short: decode each original
// PNG once into a document-owned Blob URL, without fetching or changing CSP.
const bootArt=`(() => {
  for (const asset of ${JSON.stringify(embeddedArt)}) {
    const binary=atob(asset.bytes), bytes=new Uint8Array(binary.length);
    for (let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
    const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));
    if(asset.background)document.documentElement.style.setProperty(asset.variable,'url("'+url+'")');
    for(const image of document.querySelectorAll('img[data-preview-image]')){
      if(image.dataset.previewImage===asset.file)image.src=url;
    }
  }
  // Keep URLs for this document's lifetime, including back/forward-cache return.
})();`;
const code = `${logic}\n${motion}\n${settings}\n${install}\n${audio}\n${app}`;
let preview = sources['index.html']
  .replace('<html lang="en">', '<html lang="en" data-preview="true">')
  // Canvas supplies its own no-network CSP; the standalone app's script-src
  // policy must not block the preview's deliberately bundled inline script.
  .replace(/  <meta http-equiv="Content-Security-Policy"[^>]+>\n/, '')
  .replace(/  <link rel="(?:icon|apple-touch-icon|manifest)"[^>]+>\n/g, '')
  .replace('  <link rel="stylesheet" href="./styles.css">', `<style>${css}</style>`)
  .replace('  <script type="module" src="./app.js"></script>', '')
  .replace('href="./" aria-label=', 'href="#" aria-label=')
  .replace('</body>', `<script>${bootArt}\n${code}\n$('offline-status').textContent = 'INTERACTIVE PREVIEW';\n</script></body>`);
for (const file of artFiles) preview = preview.replaceAll(`src="./${file}"`, `data-preview-image="${file}"`);
await mkdir(resolve(root, 'test-results'), { recursive: true });
await writeFile(resolve(root, 'test-results/preview.html'), preview);
const hashes = Object.fromEntries(files.map(file => [file, createHash('sha256').update(sources[file]).digest('hex')]));
for (const file of artFiles) hashes[file] = createHash('sha256').update(art[file]).digest('hex');
hashes['assets/yay-third.wav'] = createHash('sha256').update(clip).digest('hex');
hashes['assets/wheel-spin.wav'] = createHash('sha256').update(wheel).digest('hex');
await writeFile(resolve(root, 'test-results/preview-receipt.json'), JSON.stringify({ sources: hashes, preview: createHash('sha256').update(preview).digest('hex'), note: 'Same application bundled inline; PWA registration is intentionally disabled for sandboxed preview.' }, null, 2) + '\n');
console.log('Interactive preview saved to test-results/preview.html');