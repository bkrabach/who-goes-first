import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWinnerSound } from '../audio.js';

function setup(options = {}) {
  const effects = [];
  const statuses = [];
  let visible = true;
  let context;
  class FakeContext {
    state = 'suspended';
    sampleRate = 44100;
    destination = {};
    constructor() { context = this; }
    async decodeAudioData(bytes) { return options.decode ? options.decode(bytes) : { duration:.995 }; }
    resume() {
      effects.push('resume');
      if (options.rejectResume) return Promise.reject(new Error('Blocked'));
      this.state = 'running';
      return Promise.resolve();
    }
    createBuffer() { return {duration:1/44100}; }
    createBufferSource() {
      const node = {
        buffer:null, onended:null,
        connect() {},
        disconnect() { effects.push('disconnect'); },
        start() {
          if (options.failStart) throw new Error('Audio hardware unavailable');
          effects.push(node.buffer.duration > .1 ? 'yay' : 'unlock');
        },
        stop() { effects.push('stop'); node.onended?.(); }
      };
      return node;
    }
  }
  const cue = createWinnerSound({
    spinUrl: null,
    AudioContextClass: options.noContext ? null : FakeContext,
    fetchAudio: options.fetchAudio || (async () => new ArrayBuffer(8)),
    isVisible: () => visible,
    onStatus: status => statuses.push(status)
  });
  return {cue,effects,statuses,context:() => context,hide:() => {visible=false;}};
}

test('audio loads once, unlocks on prepare, and plays only once per landing', async () => {
  const {cue,effects} = setup();
  assert.equal(await cue.ready,true);
  assert.deepEqual(effects,[]);
  cue.prepare();
  assert.deepEqual(effects,['resume','unlock']);
  assert.equal(cue.play(),true);
  assert.equal(cue.play(),false);
  assert.equal(effects.filter(e => e === 'yay').length,1);
});
test('preparing the next spin stops and disconnects the previous cue', async () => {
  const {cue,effects} = setup();
  await cue.ready;
  cue.prepare(); cue.play(); cue.prepare();
  assert.ok(effects.includes('stop'));
  assert.ok(effects.includes('disconnect'));
  assert.equal(cue.play(),true);
});
test('cancellation or hiding prevents current and delayed playback', async () => {
  const {cue,effects,hide} = setup();
  await cue.ready;
  cue.prepare(); cue.cancel();
  assert.equal(cue.play(),false);
  cue.prepare(); hide();
  assert.equal(cue.play(),false);
  assert.ok(!effects.includes('yay'));
});
test('a late decode does not replay a missed landing', async () => {
  let finish;
  const {cue,effects} = setup({decode:() => new Promise(resolve => {finish=resolve;})});
  await new Promise(resolve => setImmediate(resolve));
  cue.prepare();
  assert.equal(cue.play(),false);
  finish({duration:.995});
  await cue.ready;
  assert.ok(!effects.includes('yay'));
  assert.equal(cue.play(),false);
  cue.prepare();
  assert.equal(cue.play(),true);
});
test('unsupported, missing, and invalid audio fail safely', async () => {
  for (const options of [
    {noContext:true},
    {fetchAudio:async () => {throw new Error('Offline/missing');}},
    {decode:async () => {throw new Error('Invalid WAV');}}
  ]) {
    const {cue} = setup(options);
    assert.equal(await cue.ready,false);
    assert.doesNotThrow(() => cue.prepare());
    assert.equal(cue.play(),false);
  }
});
test('blocked resume and interrupted contexts cannot queue stale sounds', async () => {
  const {cue,effects,context} = setup({rejectResume:true});
  await cue.ready;
  cue.prepare();
  assert.equal(cue.play(),false);
  await new Promise(resolve => setImmediate(resolve));
  context().state = 'running';
  assert.equal(cue.play(),false);
  assert.ok(!effects.includes('yay'));
  cue.prepare();
  context().state = 'interrupted';
  assert.equal(cue.play(),false);
});
test('start failure never escapes into winner selection', async () => {
  const {cue} = setup({failStart:true});
  await cue.ready;
  assert.doesNotThrow(() => cue.prepare());
  assert.equal(cue.play(),false);
});
test('inline audio bytes bypass fetch entirely in a no-network sandbox', async () => {
  const originalFetch = globalThis.fetch;
  let fetched = false;
  let decoded;
  globalThis.fetch = async () => { fetched = true; throw new Error('CSP blocked fetch'); };
  try {
    class Context {
      state = 'suspended';
      async decodeAudioData(bytes) { decoded = [...new Uint8Array(bytes)]; return {duration:1}; }
    }
    const cue = createWinnerSound({url:'data:audio/wav;base64,AQIDBA==',spinUrl:null,AudioContextClass:Context});
    assert.equal(await cue.ready,true);
    assert.equal(fetched,false);
    assert.deepEqual(decoded,[1,2,3,4]);
  } finally {globalThis.fetch = originalFetch;}
});
test('load and playback failures retain a visible diagnostic instead of silent failure', async () => {
  const failed = setup({fetchAudio:async () => {throw new Error('CSP blocked fetch');}});
  assert.equal(await failed.cue.ready,false);
  assert.match(failed.statuses.at(-1).message,/could not load/);
  assert.equal(failed.statuses.at(-1).error,'CSP blocked fetch');
  const blocked = setup({rejectResume:true});
  await blocked.cue.ready;
  assert.equal(await blocked.cue.test(),false);
  assert.match(blocked.statuses.at(-1).message,/browser blocked sound/);
});
test('explicit Test sound resumes within its gesture and plays after resume', async () => {
  const {cue,effects,statuses} = setup();
  await cue.ready;
  assert.equal(await cue.test(),true);
  assert.equal(effects.filter(effect => effect==='yay').length,1);
  assert.match(statuses.at(-1).message,/Playback started/);
});
test('muting or zero volume suppresses playback without changing cue timing',async()=>{
  const {cue,effects}=setup();
  await cue.ready;
  cue.configure({sound:false,volume:100});
  cue.prepare();assert.equal(cue.play(),false);
  cue.configure({sound:true,volume:0});
  cue.prepare();assert.equal(cue.play(),false);
  assert.equal(effects.filter(effect=>effect==='yay').length,0);
  cue.configure({sound:true,volume:50});
  cue.prepare();assert.equal(cue.play(),true);
});
test('trimmed WAV is the recorded third phrase with clean zero-valued edges', async () => {
  const bytes = await readFile(new URL('../assets/yay-third.wav',import.meta.url));
  const receipt = JSON.parse(await readFile(new URL('../assets/yay-third-receipt.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.outputSha256);
  assert.equal(bytes.toString('ascii',0,4),'RIFF');
  assert.equal(bytes.toString('ascii',8,12),'WAVE');
  assert.equal(bytes.readUInt16LE(20),1);
  assert.equal(bytes.readUInt16LE(22),2);
  assert.equal(bytes.readUInt32LE(24),44100);
  assert.equal(bytes.readUInt16LE(34),16);
  assert.equal(receipt.selectedInstance,3);
  assert.ok(receipt.startSeconds > receipt.detectedPhrases[1].end);
  assert.ok(receipt.startSeconds < receipt.detectedPhrases[2].start);
  assert.ok(receipt.endSeconds > receipt.detectedPhrases[2].end);
  assert.ok(receipt.duration > .9 && receipt.duration < 1.1);
  let peak = 0;
  for (let i=44; i<bytes.length; i+=2) peak = Math.max(peak,Math.abs(bytes.readInt16LE(i)));
  assert.ok(peak > 1000 && peak < 32767);
  assert.equal(bytes.readInt16LE(44),0);
  assert.equal(bytes.readInt16LE(46),0);
  assert.equal(bytes.readInt16LE(bytes.length-4),0);
  assert.equal(bytes.readInt16LE(bytes.length-2),0);
});