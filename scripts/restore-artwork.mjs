// Restore the user's actual screenshot art, without generative redrawing.
// Usage: ORIGINAL_SCREENSHOT=/absolute/path/to/original.png node scripts/restore-artwork.mjs
// The input hash prevents a different screenshot from being edited by accident.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const expectedHash = 'b5dadfe7182f335a395edf98d320eff33108bc458a85f84c27a0905398647b62';
if (!process.env.ORIGINAL_SCREENSHOT) throw new Error('Set ORIGINAL_SCREENSHOT to the user-supplied original screenshot.');
const input = await readFile(process.env.ORIGINAL_SCREENSHOT);
const hash = createHash('sha256').update(input).digest('hex');
if (hash !== expectedHash) throw new Error('Original screenshot does not match the inspected reference.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async data => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    if (image.naturalWidth !== 640 || image.naturalHeight !== 960) throw new Error('Unexpected screenshot dimensions.');
    const source = document.createElement('canvas');
    source.width = 640;
    source.height = 960;
    const ctx = source.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const original = ctx.getImageData(0, 0, 640, 960);
    const restored = ctx.getImageData(0, 0, 640, 960);
    const at = (x, y, channel) => original.data[(Math.max(0, Math.min(959, y)) * 640 + Math.max(0, Math.min(639, x))) * 4 + channel];
    function mean(x, y, channel, radius = 5) {
      let total = 0;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) total += at(x + dx, y + dy, channel);
      return total / (radius * 2 + 1) ** 2;
    }
    // Only these five baked-in name areas are repaired. Every pixel outside
    // these rectangles is the untouched screenshot, including button lettering,
    // parchment edges, the Celtic ornament, arrows, patina and bevels.
    const names = [
      { x:178, y:210, w:279, h:38 },
      { x:176, y:289, w:281, h:57 },
      { x:195, y:377, w:256, h:54 },
      { x:160, y:465, w:324, h:61 },
      { x:168, y:556, w:310, h:34 }
    ];
    for (const box of names) {
      for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
        const fraction = (y - box.y + 1) / (box.h + 1);
        // Nearby unlettered rows supply the parchment's original illumination.
        // A clean strip between names restores grain instead of flat paint.
        const sampleY = 344 + (y - box.y) % 30;
        const feather = Math.min(1, (x - box.x + 1) / 5, (box.x + box.w - x) / 5, (y - box.y + 1) / 4, (box.y + box.h - y) / 4);
        for (let channel = 0; channel < 3; channel++) {
          const top = mean(x, box.y - 7, channel);
          const bottom = mean(x, box.y + box.h + 7, channel);
          const grain = at(x, sampleY, channel) - mean(x, sampleY, channel, 3);
          const paper = top * (1 - fraction) + bottom * fraction + grain;
          const index = (y * 640 + x) * 4 + channel;
          restored.data[index] = Math.round(paper * feather + original.data[index] * (1 - feather));
        }
      }
    }
    ctx.putImageData(restored, 0, 0);
    const plate = document.createElement('canvas');
    plate.width = 640;
    plate.height = 920;
    plate.getContext('2d').drawImage(source, 0, 40, 640, 920, 0, 0, 640, 920);
    const backdrop = document.createElement('canvas');
    backdrop.width = 320;
    backdrop.height = 44;
    backdrop.getContext('2d').drawImage(image, 2, 42, 360, 84, 0, 0, 320, 44);
    // Prove that the original artwork outside the name repair areas is exact.
    let changedOutsideRepairs = 0;
    for (let y = 40; y < 960; y++) for (let x = 0; x < 640; x++) {
      if (names.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)) continue;
      for (let c = 0; c < 4; c++) if (original.data[(y * 640 + x) * 4 + c] !== restored.data[(y * 640 + x) * 4 + c]) changedOutsideRepairs++;
    }
    return { plate: plate.toDataURL('image/png').split(',')[1], backdrop: backdrop.toDataURL('image/png').split(',')[1], changedOutsideRepairs, names };
  }, input.toString('base64'));
  if (result.changedOutsideRepairs !== 0) throw new Error('Artwork was changed outside the intended repair areas.');
  await mkdir(resolve(root, 'assets'), { recursive: true });
  const hashes = {};
  for (const [file, bytes] of [['main-screen.png', result.plate], ['gold-texture.png', result.backdrop]]) {
    const body = Buffer.from(bytes, 'base64');
    await writeFile(resolve(root, 'assets', file), body);
    hashes[file] = createHash('sha256').update(body).digest('hex');
  }
  await writeFile(resolve(root, 'assets/artwork-receipt.json'), JSON.stringify({
    sourceSha256: hash,
    sourceDimensions: [640, 960],
    crop: { x:0, y:40, width:640, height:920 },
    nameRepairRectangles: result.names,
    changedPixelsOutsideRepairs: result.changedOutsideRepairs,
    method: 'Original screenshot crop; local parchment texture interpolation only inside baked-in name areas. No AI-generated artwork.',
    outputs: hashes
  }, null, 2) + '\n');
  console.log('Restored original main-screen artwork; zero changed pixels outside the name repair areas.');
} finally { await browser.close(); }