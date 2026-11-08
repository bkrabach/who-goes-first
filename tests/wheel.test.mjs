import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWinnerSound } from '../audio.js';

function fixture({slowResume=false,missing='',slowLoad=false,getAudioSession=()=>undefined}={}) {
  const nodes=[];
  let context,resolveResume,resolveWheel;
  let visible=true;
  class Context {
    state='suspended'; sampleRate=44100; destination={};
    constructor(){context=this;}
    async decodeAudioData(bytes){return {duration:bytes[0]===1?.995:3.2};}
    resume(){
      if(slowResume)return new Promise(resolve=>{resolveResume=()=>{this.state='running';resolve();};});
      this.state='running';return Promise.resolve();
    }
    createBuffer(){return {duration:1/44100};}
    createGain(){return {gain:{value:1},connect(){},disconnect(){}};}
    createBufferSource(){
      const node={buffer:null,stopped:false,started:false,offset:null,onended:null,
        connect(){},disconnect(){},
        start(when,offset){this.started=true;this.offset=offset;},
        stop(){this.stopped=true;this.onended?.();}};
      nodes.push(node);return node;
    }
  }
  const audio=createWinnerSound({
    AudioContextClass:Context,
    fetchAudio:async path=>{
      const wheel=path.includes('wheel');
      if((wheel&&missing==='wheel')||(!wheel&&missing==='yay'))throw new Error('missing');
      if(wheel&&slowLoad)await new Promise(resolve=>{resolveWheel=resolve;});
      return new Uint8Array([wheel?2:1]);
    },
    isVisible:()=>visible,
    getAudioSession
  });
  return {audio,nodes,context:()=>context,resume:()=>resolveResume(),load:()=>resolveWheel(),hide:()=>{visible=false;}};
}
const animation=()=>({currentTime:0,playState:'running'});

test('wheel and Yay run independently; finishing stops only wheel',async()=>{
  const {audio,nodes}=fixture();await Promise.all([audio.ready,audio.spinReady]);
  const unlocked=audio.prepare();audio.startSpin(animation(),3200,unlocked);
  const wheel=nodes.find(n=>n.buffer?.duration===3.2);
  assert.ok(wheel?.started);assert.equal(wheel.offset,0);
  assert.equal(audio.play(),true);
  assert.equal(wheel.stopped,false);
  const yay=nodes.find(n=>n.buffer?.duration===.995);
  audio.stopSpin();assert.equal(wheel.stopped,true);assert.equal(yay.stopped,false);
  audio.cancel();assert.equal(yay.stopped,true);
});
test('optional playback session lasts through the wheel-to-Yay boundary, then releases',async()=>{
  const session={type:'auto'},f=fixture({getAudioSession:()=>session});await Promise.all([f.audio.ready,f.audio.spinReady]);
  f.audio.configure({playInSilentMode:true});
  f.audio.startSpin(animation(),3200,f.audio.prepare());
  f.nodes.find(node=>node.buffer?.duration===3.2).onended();
  assert.equal(session.type,'playback');
  assert.equal(f.audio.play(),true);f.audio.stopSpin();assert.equal(session.type,'playback');
  f.nodes.find(node=>node.buffer?.duration===.995).onended();assert.equal(session.type,'auto');
});
test('explicit wheel test releases the optional session at its natural end',async()=>{
  const session={type:'auto'},f=fixture({getAudioSession:()=>session});await f.audio.spinReady;
  f.audio.configure({playInSilentMode:true});assert.equal(await f.audio.testSpin(),true);
  assert.equal(session.type,'playback');
  f.nodes.find(node=>node.buffer?.duration===3.2).onended();assert.equal(session.type,'auto');
});
test('short/reduced spins never start wheel',async()=>{
  const {audio,nodes}=fixture();await audio.spinReady;
  audio.startSpin(animation(),100,audio.prepare());
  assert.equal(nodes.filter(n=>n.buffer?.duration===3.2).length,0);
});
test('delayed resume respects current offset and cancellation epoch',async()=>{
  for(const cancel of [false,true]){
    const {audio,nodes,resume}=fixture({slowResume:true});await audio.spinReady;
    const unlocked=audio.prepare();const spin=animation();spin.currentTime=80;
    audio.startSpin(spin,3200,unlocked);
    if(cancel)audio.cancel();
    resume();await unlocked;await Promise.resolve();
    const wheel=nodes.find(n=>n.buffer?.duration===3.2);
    if(cancel)assert.equal(wheel,undefined);
    else assert.equal(wheel.offset,.08);
  }
});
test('late resume never starts wheel even if animation time is still zero',async()=>{
  const {audio,nodes,resume}=fixture({slowResume:true});await audio.spinReady;
  const unlocked=audio.prepare();audio.startSpin(animation(),3200,unlocked);
  await new Promise(resolve=>setTimeout(resolve,170));
  resume();await unlocked;await Promise.resolve();
  assert.equal(nodes.filter(n=>n.buffer?.duration===3.2).length,0);
});
test('late load, hidden page, paused and canceled animations never start wheel',async()=>{
  for(const state of ['paused','idle','finished','hidden']){
    const {audio,nodes,hide}=fixture();await audio.spinReady;
    const unlocked=audio.prepare();const spin=animation();
    if(state==='hidden')hide();else spin.playState=state;
    audio.startSpin(spin,3200,unlocked);
    assert.equal(nodes.filter(n=>n.buffer?.duration===3.2).length,0);
  }
  const f=fixture({slowLoad:true});await f.audio.ready;
  f.audio.startSpin(animation(),3200,f.audio.prepare());
  f.load();await f.audio.spinReady;
  assert.equal(f.nodes.filter(n=>n.buffer?.duration===3.2).length,0);
});
test('missing wheel does not disable Yay and missing Yay does not disable wheel',async()=>{
  for(const missing of ['wheel','yay']){
    const {audio,nodes}=fixture({missing});
    const [yay,wheel]=await Promise.all([audio.ready,audio.spinReady]);
    assert.equal(yay,missing!=='yay');assert.equal(wheel,missing!=='wheel');
    audio.startSpin(animation(),3200,audio.prepare());
    assert.equal(audio.play(),missing!=='yay');
    assert.equal(nodes.some(n=>n.buffer?.duration===3.2),missing!=='wheel');
  }
});
test('wheel WAV is a 3.2s stereo sample with clean edges and preserved provenance',async()=>{
  const wav=await readFile(new URL('../assets/wheel-spin.wav',import.meta.url));
  const receipt=JSON.parse(await readFile(new URL('../assets/wheel-spin-receipt.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(wav).digest('hex'),receipt.outputSha256);
  assert.equal(wav.readUInt16LE(22),2);assert.equal(wav.readUInt32LE(24),44100);
  assert.equal(wav.readUInt32LE(40)/4/44100,3.2);
  assert.equal(wav.readInt16LE(44),0);assert.equal(wav.readInt16LE(wav.length-2),0);
  assert.ok(receipt.peak>0&&receipt.peak<1);
  assert.ok(receipt.sampledSeconds<receipt.sourceDuration/10);
  assert.equal(receipt.segments.length,6);
  assert.ok(receipt.segments.every(segment=>segment.playbackRate===1));
  assert.equal(receipt.playbackRate,1);
  assert.equal(receipt.pitchShift,'none');
  assert.equal(receipt.resampling,false);
  assert.equal(receipt.crossfadeFrames,441);
  assert.equal(receipt.segments.reduce((sum,segment)=>sum+segment.frameCount,0)-5*441,141120);
  assert.equal(receipt.licenseUrl,'https://creativecommons.org/licenses/sampling+/1.0/');
});
test('native-speed wheel samples match the original between joins and edge fades',async()=>{
  if(!process.env.WHEEL_SOURCE)return;
  const original=await readFile(process.env.WHEEL_SOURCE);
  const wav=await readFile(new URL('../assets/wheel-spin.wav',import.meta.url));
  const receipt=JSON.parse(await readFile(new URL('../assets/wheel-spin-receipt.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(original).digest('hex'),receipt.sourceSha256);
  let dataOffset;
  for(let p=12;p+8<=original.length;){
    const id=original.toString('ascii',p,p+4),size=original.readUInt32BE(p+4);
    if(id==='SSND')dataOffset=p+16+original.readUInt32BE(p+8);
    p+=8+size+(size%2);
  }
  let checked=0;
  for(const segment of receipt.segments){
    for(let i=receipt.crossfadeFrames;i<segment.frameCount-receipt.crossfadeFrames;i++){
      const outputFrame=segment.outputStartFrame+i;
      if(outputFrame<Math.ceil(.012*44100)||outputFrame>=141120-Math.ceil(.12*44100))continue;
      for(let channel=0;channel<2;channel++){
        assert.equal(wav.readInt16LE(44+(outputFrame*2+channel)*2),
          original.readInt16BE(dataOffset+((segment.sourceStartFrame+i)*2+channel)*2));
        checked++;
      }
    }
  }
  assert.ok(checked>200000);
});