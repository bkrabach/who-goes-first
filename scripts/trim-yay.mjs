// Decode the exact supplied MP3 with the installed browser's audio decoder.
// Inspect first; only --extract writes the third phrase as a lossless PCM WAV.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.env.YAY_SOURCE;
if (!source) throw new Error('Set YAY_SOURCE to the supplied 61691__ifartinurgeneraldirection__yay.mp3.');
const input = await readFile(source);
const sourceHash = createHash('sha256').update(input).digest('hex');
if (sourceHash !== '679ca101933e16d01c40c0765a01c2ff5da997dfce6060a5aea281ee6472ddf4') throw new Error('Source does not match the inspected attachment.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const result = await page.evaluate(async encoded => {
    const raw = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const decoder = new OfflineAudioContext(2, 1, 44100);
    const audio = await decoder.decodeAudioData(raw.buffer);
    const channels = Array.from({length:audio.numberOfChannels}, (_,c) => audio.getChannelData(c));
    const step = Math.round(audio.sampleRate * .01);
    const rms = [];
    let peak = 0;
    for (let from=0; from<audio.length; from+=step) {
      let sum = 0, count = 0;
      for (let i=from; i<Math.min(from+step,audio.length); i++) for (const channel of channels) {
        sum += channel[i] ** 2;
        peak = Math.max(peak, Math.abs(channel[i]));
        count++;
      }
      rms.push(Math.sqrt(sum/count));
    }
    // The room-noise floor is about -41dBFS, so silence is not digital zero.
    // The inspected -35dBFS gate separates all three vocalizations cleanly.
    const threshold = 10 ** (-35 / 20);
    const voiced = [];
    for (let i=0; i<rms.length; i++) if (rms[i] >= threshold) voiced.push(i);
    const phrases = [];
    for (const frame of voiced) {
      const current = phrases.at(-1);
      if (current && frame * .01 - current.end <= .15) current.end = (frame+1) * .01;
      else phrases.push({start:frame * .01,end:(frame+1) * .01});
    }
    return {
      duration:audio.duration, sampleRate:audio.sampleRate, channels:audio.numberOfChannels,
      length:audio.length, peak, threshold, phrases, rms,
      // Interleaved samples are passed only for the requested bounded excerpt.
      data: phrases.length === 3 ? (() => {
        const third = phrases[2];
        const start = Math.max(0, Math.floor((third.start-.025) * audio.sampleRate));
        const end = Math.min(audio.length, Math.ceil((third.end+.08) * audio.sampleRate));
        const samples = [];
        const fade = Math.round(audio.sampleRate * .005);
        for (let i=start; i<end; i++) {
          const gain = Math.min(1, (i-start)/fade, (end-1-i)/fade);
          for (const channel of channels) samples.push(Math.round(Math.max(-1,Math.min(1,channel[i]*gain)) * 32767));
        }
        return {startSample:start,endSample:end,fadeSamples:fade,samples};
      })() : null
    };
  }, input.toString('base64'));
  const {data,rms,...analysis} = result;
  console.log(JSON.stringify(analysis,null,2));
  await mkdir(resolve(root,'test-results'),{recursive:true});
  await writeFile(resolve(root,'test-results/yay-analysis.json'),JSON.stringify({...analysis,rms},null,2)+'\n');
  if (process.argv.includes('--extract')) {
    if (!data) throw new Error(`Expected exactly three separate phrases; detected ${result.phrases.length}. Inspect before extracting.`);
    const bytes = Buffer.alloc(44 + data.samples.length * 2);
    bytes.write('RIFF',0); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVE',8);
    bytes.write('fmt ',12); bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20);
    bytes.writeUInt16LE(result.channels,22); bytes.writeUInt32LE(result.sampleRate,24);
    bytes.writeUInt32LE(result.sampleRate*result.channels*2,28); bytes.writeUInt16LE(result.channels*2,32); bytes.writeUInt16LE(16,34);
    bytes.write('data',36); bytes.writeUInt32LE(bytes.length-44,40);
    data.samples.forEach((sample,i) => bytes.writeInt16LE(sample,44+i*2));
    const path = resolve(root,'assets/yay-third.wav');
    await writeFile(path,bytes);
    const receipt = {
      sourceName:'61691__ifartinurgeneraldirection__yay.mp3',sourceSha256:sourceHash,
      sourceDuration:result.duration,detectedPhrases:result.phrases,selectedInstance:3,
      startSeconds:data.startSample/result.sampleRate,endSeconds:data.endSample/result.sampleRate,
      duration:(data.endSample-data.startSample)/result.sampleRate,
      startSample:data.startSample,endSample:data.endSample,sampleRate:result.sampleRate,channels:result.channels,
      fadeMilliseconds:5,normalization:'none',format:'16-bit PCM WAV',bytes:bytes.length,
      outputSha256:createHash('sha256').update(bytes).digest('hex'),
      method:'Third distinct waveform phrase only; 25ms lead-in, 80ms release padding, 5ms edge fades to avoid clicks. No changes to pitch or speed.'
    };
    await writeFile(resolve(root,'assets/yay-third-receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    console.log(`Extracted ${receipt.duration.toFixed(3)}s third Yay to ${path}`);
  }
} finally { await browser.close(); }