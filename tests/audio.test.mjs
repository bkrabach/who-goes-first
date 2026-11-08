import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWinnerSound } from '../audio.js';

function setup(options = {}) {
  const effects = [];
  const nodes = [];
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
      if (options.resume) return options.resume(this);
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
      nodes.push(node);
      return node;
    }
  }
  const cue = createWinnerSound({
    spinUrl: null,
    AudioContextClass: options.noContext ? null : FakeContext,
    fetchAudio: options.fetchAudio || (async () => new ArrayBuffer(8)),
    isVisible: () => visible,
    getAudioSession: options.getAudioSession || (()=>undefined),
    onStatus: status => statuses.push(status)
  });
  return {cue,effects,statuses,nodes,context:() => context,hide:() => {visible=false;}};
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
test('optional Silent Mode playback is claimed within the gesture and restored after Yay',async()=>{
  const writes=[];let type='auto';
  const session={get type(){return type;},set type(value){writes.push(value);type=value;}};
  const {cue,nodes}=setup({getAudioSession:()=>session});await cue.ready;
  cue.configure({playInSilentMode:true});assert.deepEqual(writes,[]);
  await cue.prepare();assert.deepEqual(writes,['playback']);
  cue.play();assert.equal(session.type,'playback');
  nodes.find(node=>node.buffer?.duration>.1).onended();
  assert.deepEqual(writes,['playback','auto']);
});
test('default, mute, zero volume and hidden states do not claim a playback session',async()=>{
  let writes=0;const session={get type(){return 'auto';},set type(value){writes++;}};
  const {cue,hide}=setup({getAudioSession:()=>session});await cue.ready;
  await cue.prepare();cue.play();assert.equal(writes,0);
  for(const settings of [{sound:false,playInSilentMode:true},{volume:0,playInSilentMode:true}]){
    cue.configure(settings);await cue.prepare();assert.equal(writes,0);
  }
  cue.configure({playInSilentMode:true});hide();await cue.prepare();assert.equal(writes,0);
});
test('missing/rejected session support fails safely; blocked resume releases the optional policy',async()=>{
  for(const getAudioSession of [()=>undefined,()=>{throw new Error('Unavailable');},()=>({get type(){return 'auto';},set type(value){throw new Error('Rejected');}})]){
    const {cue}=setup({getAudioSession});await cue.ready;cue.configure({playInSilentMode:true});
    assert.equal(await cue.prepare(),true);assert.equal(cue.play(),true);
  }
  const session={type:'ambient'},f=setup({getAudioSession:()=>session,rejectResume:true});
  await f.cue.ready;f.cue.configure({playInSilentMode:true});
  assert.equal(await f.cue.prepare(),false);assert.equal(session.type,'ambient');assert.equal(f.cue.play(),false);
});
test('cancel, mute and opting out restore only this player’s owned session',async()=>{
  const session={type:'ambient'},f=setup({getAudioSession:()=>session});await f.cue.ready;
  for(const end of [()=>f.cue.cancel(),()=>f.cue.configure({sound:false,playInSilentMode:true}),()=>f.cue.configure({playInSilentMode:false})]){
    f.cue.configure({playInSilentMode:true});await f.cue.prepare();assert.equal(session.type,'playback');
    end();assert.equal(session.type,'ambient');
  }
  session.type='playback';f.cue.configure({playInSilentMode:true});await f.cue.prepare();f.cue.cancel();assert.equal(session.type,'playback');
  session.type='ambient';await f.cue.prepare();session.type='play-and-record';f.cue.cancel();assert.equal(session.type,'play-and-record');
});
test('a stale resume rejection cannot release a later spin’s playback session',async()=>{
  const session={type:'auto'};let rejectFirst,calls=0;
  const f=setup({getAudioSession:()=>session,resume:context=>{
    if(++calls===1)return new Promise((_resolve,reject)=>{rejectFirst=reject;});
    context.state='running';return Promise.resolve();
  }});
  await f.cue.ready;f.cue.configure({playInSilentMode:true});
  const old=f.cue.prepare();await f.cue.prepare();assert.equal(session.type,'playback');
  rejectFirst(new Error('Old spin failed'));await old;assert.equal(session.type,'playback');
  f.cue.cancel();assert.equal(session.type,'auto');
});
test('a canceled Test sound cannot consume a newer spin’s landing cue',async()=>{
  const session={type:'auto'};let resolveFirst,calls=0;
  const f=setup({getAudioSession:()=>session,resume:context=>{
    if(++calls===1)return new Promise(resolve=>{resolveFirst=()=>{context.state='running';resolve();};});
    context.state='running';return Promise.resolve();
  }});
  await f.cue.ready;f.cue.configure({playInSilentMode:true});
  const oldTest=f.cue.test();
  f.cue.cancel();await f.cue.prepare();
  resolveFirst();assert.equal(await oldTest,false);
  assert.equal(f.effects.filter(effect=>effect==='yay').length,0);
  assert.equal(session.type,'playback');
  assert.equal(f.cue.play(),true);
  assert.equal(f.effects.filter(effect=>effect==='yay').length,1);
  f.nodes.find(node=>node.buffer?.duration>.1).onended();
  assert.equal(session.type,'auto');
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