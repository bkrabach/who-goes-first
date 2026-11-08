import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleMotion,reelKeyframes,motionBlur} from '../motion.js';
test('coast and assisted settle are continuous, monotone, and end at zero speed',()=>{
  let previous={position:0,velocity:2.5};
  for(let i=0;i<=10000;i++){
    const state=sampleMotion(i/10000);
    assert.ok(state.position>=previous.position-1e-10);
    assert.ok(state.position<=1+1e-10);
    assert.ok(state.velocity>=0);
    assert.ok(state.velocity<=previous.velocity+.001);
    previous=state;
  }
  assert.deepEqual(sampleMotion(1),{position:1,velocity:0});
  for(const time of [.72,.9]){
    const before=sampleMotion(time-1e-7),after=sampleMotion(time+1e-7);
    assert.ok(Math.abs(before.position-after.position)<.000001);
    assert.ok(Math.abs(before.velocity-after.velocity)<.00001);
  }
});
test('last tenth is a brief settle, not a long sub-pixel crawl or overshoot',()=>{
  assert.equal(sampleMotion(.9).position,.991);
  assert.ok((1-sampleMotion(.95).position)*38*88>5);
  assert.ok((1-sampleMotion(.99).position)*38*88<1);
  assert.ok(sampleMotion(.9).velocity>0);
});
test('blur follows velocity and is almost clear before landing, exactly clear at rest',()=>{
  let previous=Infinity;
  for(let i=0;i<=1000;i++){
    const blur=motionBlur(i/1000,38,3200);
    assert.ok(blur<=previous+.001);
    previous=blur;
  }
  assert.ok(motionBlur(.1,38,3200)>8);
  assert.ok(motionBlur(.85,38,3200)<2);
  assert.ok(motionBlur(.98,38,3200)<.25);
  assert.equal(motionBlur(1,38,3200),0);
});
test('motion keyframes align to the exact chosen winner and use responsive percentages',()=>{
  const frames=reelKeyframes(38,41);
  assert.equal(frames.length,161);
  assert.equal(frames[0].transform,'translateY(-0%)');
  assert.equal(frames.at(-1).transform,`translateY(-${38/41*100}%)`);
  assert.equal(frames.at(-1).offset,1);
  assert.equal(reelKeyframes(38,41,true).length,2);
});