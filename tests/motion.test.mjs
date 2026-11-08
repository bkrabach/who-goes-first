import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleMotion,reelKeyframes,motionBlur} from '../motion.js';
import {createReel} from '../logic.js';
test('coast and assisted settle are continuous, monotone, and end at zero speed',()=>{
  let previous=sampleMotion(0);
  for(let i=0;i<=10000;i++){
    const state=sampleMotion(i/10000);
    assert.ok(state.position>=previous.position-1e-10);
    assert.ok(state.position<=1+1e-10);
    assert.ok(state.velocity>=0);
    assert.ok(state.velocity<=previous.velocity+.001);
    previous=state;
  }
  assert.deepEqual(sampleMotion(1),{position:1,velocity:0});
  for(const time of [.42,.78,.9]){
    const before=sampleMotion(time-1e-7),after=sampleMotion(time+1e-7);
    assert.ok(Math.abs(before.position-after.position)<.000001);
    assert.ok(Math.abs(before.velocity-after.velocity)<.00001);
  }
});
test('holds fast cruise for 1.344 seconds, then brakes much faster without losing opening speed',()=>{
  for(const count of [2,6,25,100]){
    const crew=Array.from({length:count},(_,i)=>({id:`p${i}`,name:`Player ${i}`}));
    for(const player of crew){
      const oldReel=createReel(crew,player.id,6),reel=createReel(crew,player.id,16);
      assert.ok(sampleMotion(0).velocity*reel.target>=3.8*oldReel.target);
      assert.equal(reel.names[reel.target],player.name);
    }
  }
  for(let i=0;i<=42;i++)assert.ok(Math.abs(sampleMotion(i/100).velocity-1.6)<1e-12);
  assert.equal(sampleMotion(.42).position,.672);
  assert.ok(sampleMotion(.7).velocity<sampleMotion(.42).velocity*.3);
  assert.ok(sampleMotion(.78).velocity<sampleMotion(.42).velocity*.1);
  // Extra turns are offset by a shorter normalized tail: no drawn-out finish.
  assert.equal(sampleMotion(.9).position,.9964);
  assert.ok(Math.abs(sampleMotion(.9).velocity-.064)<1e-12);
});
test('last tenth is a brief settle, not a long sub-pixel crawl or overshoot',()=>{
  assert.equal(sampleMotion(.9).position,.9964);
  assert.ok((1-sampleMotion(.95).position)*98*88>5);
  assert.ok((1-sampleMotion(.99).position)*98*88<1);
  assert.ok(sampleMotion(.9).velocity>0);
});
test('blur follows velocity and is almost clear before landing, exactly clear at rest',()=>{
  let previous=Infinity;
  for(let i=0;i<=1000;i++){
    const blur=motionBlur(i/1000,98,3200);
    assert.ok(blur<=previous+.001);
    previous=blur;
  }
  assert.ok(motionBlur(.1,98,3200)>8);
  assert.ok(Math.abs(motionBlur(.1,98,3200)-motionBlur(.4,98,3200))<1e-12);
  assert.ok(motionBlur(.85,98,3200)<2);
  assert.ok(motionBlur(.98,98,3200)<.25);
  assert.equal(motionBlur(1,98,3200),0);
});
test('motion keyframes align to the exact chosen winner and use responsive percentages',()=>{
  const frames=reelKeyframes(38,41);
  assert.equal(frames.length,161);
  assert.equal(frames[0].transform,'translateY(-0%)');
  assert.equal(frames.at(-1).transform,`translateY(-${38/41*100}%)`);
  assert.equal(frames.at(-1).offset,1);
  assert.equal(reelKeyframes(38,41,true).length,2);
});
test('flick keyframes retain a fractional drag pose and travel in either direction',()=>{
  for(const[start,target]of [[3.25,100],[110.75,3]]){
    const frames=reelKeyframes(target,120,false,start);
    assert.equal(frames[0].transform,`translateY(-${start/120*100}%)`);
    assert.equal(frames.at(-1).transform,`translateY(-${target/120*100}%)`);
    assert.equal(frames.length,161);
    assert.equal(reelKeyframes(target,120,true,start).length,2);
  }
});