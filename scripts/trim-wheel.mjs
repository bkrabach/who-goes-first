// Deterministic AIFF PCM sampling; no codecs, dependencies, or source mutation.
// WHEEL_SOURCE=/path/to/supplied.aiff node scripts/trim-wheel.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.WHEEL_SOURCE) throw new Error('Set WHEEL_SOURCE to the supplied Bike Wheel Spinning.aiff.');
const source = await readFile(process.env.WHEEL_SOURCE);
const hash = createHash('sha256').update(source).digest('hex');
if (hash !== 'e2b2db239e23cb2c0f0ccd8db4421bfb8aa870309f7a402905997eeae041e739') throw new Error('Unexpected source audio hash.');
if (source.toString('ascii',0,4) !== 'FORM' || source.toString('ascii',8,12) !== 'AIFF') throw new Error('Expected AIFF');
let comm, sound;
for (let offset=12; offset+8<=source.length;) {
  const id = source.toString('ascii',offset,offset+4);
  const size = source.readUInt32BE(offset+4);
  if (id === 'COMM') comm = offset+8;
  if (id === 'SSND') sound = offset+8;
  offset += 8+size+(size%2);
}
if (!comm || !sound) throw new Error('Missing AIFF chunks');
const channels = source.readUInt16BE(comm);
const frames = source.readUInt32BE(comm+2);
const bits = source.readUInt16BE(comm+6);
// Read the AIFF 80-bit extended sample rate (positive normal number).
const exponent = (source.readUInt16BE(comm+8)&0x7fff)-16383;
const mantissa = Number(source.readBigUInt64BE(comm+10));
const sampleRate = Math.round(mantissa * 2 ** (exponent-63));
if (channels !== 2 || bits !== 16 || sampleRate !== 44100) throw new Error('Unexpected PCM format');
const dataOffset = sound+8+source.readUInt32BE(sound);
if (dataOffset+frames*channels*2>source.length) throw new Error('Truncated AIFF');
const duration = 3.2;
const outputFrames = Math.round(duration*sampleRate);
// These native-rate windows follow the real wheel's declining click density.
// Boundaries sit in lower-energy inter-click gaps; do not transpose the clicks.
const windows = [
  {start:3.060, duration:.520},
  {start:16.936, duration:.520},
  {start:30.034, duration:.520},
  {start:41.933, duration:.520},
  {start:50.978, duration:.520},
  {start:53.695, duration:.650}
];
const crossfadeFrames = Math.round(.010*sampleRate);
const mixed = new Float64Array(outputFrames*channels);
let cursor = 0;
const segments = [];
for (const [index,window] of windows.entries()) {
  const startFrame = Math.round(window.start*sampleRate);
  const frameCount = Math.round(window.duration*sampleRate);
  if (startFrame+frameCount>frames) throw new Error('Segment exceeds source audio');
  const outputStartFrame = index ? cursor-crossfadeFrames : 0;
  for (let i=0;i<frameCount;i++) {
    const overlap = index > 0 && i < crossfadeFrames;
    const weight = overlap ? i/(crossfadeFrames-1) : 1;
    for (let channel=0;channel<channels;channel++) {
      const sample = source.readInt16BE(dataOffset+((startFrame+i)*channels+channel)*2);
      const target = (outputStartFrame+i)*channels+channel;
      mixed[target] = mixed[target]*(1-weight) + sample*weight;
    }
  }
  segments.push({
    sourceStartFrame:startFrame, sourceEndFrame:startFrame+frameCount,
    startSeconds:startFrame/sampleRate, endSeconds:(startFrame+frameCount)/sampleRate,
    outputStartFrame, frameCount, playbackRate:1
  });
  cursor = outputStartFrame+frameCount;
}
if (cursor !== outputFrames) throw new Error('Splice duration does not match the spinner');
const fadeIn = .012;
const fadeOut = .12;
const out = Buffer.alloc(44+outputFrames*channels*2);
out.write('RIFF',0); out.writeUInt32LE(out.length-8,4); out.write('WAVE',8);
out.write('fmt ',12); out.writeUInt32LE(16,16); out.writeUInt16LE(1,20);
out.writeUInt16LE(channels,22); out.writeUInt32LE(sampleRate,24);
out.writeUInt32LE(sampleRate*channels*2,28); out.writeUInt16LE(channels*2,32); out.writeUInt16LE(bits,34);
out.write('data',36); out.writeUInt32LE(out.length-44,40);
let peak = 0;
let sumSquares = 0;
for (let i=0; i<outputFrames; i++) {
  const t = i/sampleRate;
  const gain = Math.min(1,t/fadeIn,(outputFrames-1-i)/sampleRate/fadeOut);
  for (let channel=0;channel<channels;channel++) {
    const sample = Math.round(mixed[i*channels+channel]*gain);
    out.writeInt16LE(sample,44+(i*channels+channel)*2);
    peak=Math.max(peak,Math.abs(sample)/32768);
    sumSquares+=(sample/32768)**2;
  }
}
const outputSha256=createHash('sha256').update(out).digest('hex');
await writeFile(resolve(root,'assets/wheel-spin.wav'),out);
await writeFile(resolve(root,'assets/wheel-spin-receipt.json'),JSON.stringify({
  sourceName:'79073__plivesey__bike-wheel-spinning.aiff',sourceSha256:hash,
  sourceDuration:frames/sampleRate,segments,
  duration,sampleRate,channels,bits,playbackRate:1,pitchShift:'none',resampling:false,
  crossfadeFrames,crossfadeMilliseconds:10,crossfadeCurve:'linear',
  sampledSeconds:segments.reduce((total,segment)=>total+segment.frameCount/sampleRate,0),
  fadeInMilliseconds:fadeIn*1000,fadeOutMilliseconds:fadeOut*1000,
  peak,rms:Math.sqrt(sumSquares/(outputFrames*channels)),
  outputSha256,bytes:out.length,
  method:'Six short sections from naturally fast through slow parts of the supplied recording, all at original 1× speed and pitch. Five 10ms linear crossfades in inter-click gaps produce exactly 3.2s. 12ms fade-in and 120ms fade-out; stereo preserved; no resampling. App mixes at 55% gain beneath Yay.',
  attribution:'Bike Wheel Spinning.aif by plivesey -- https://freesound.org/s/79073/ -- License: Sampling+',
  licenseUrl:'https://creativecommons.org/licenses/sampling+/1.0/'
},null,2)+'\n');
console.log(`Created ${duration}s native-speed wheel collage from ${segments.length} sections; peak ${peak.toFixed(3)}; SHA-256 ${outputSha256}`);