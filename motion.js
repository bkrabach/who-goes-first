// Hold a fast cruise, then brake decisively into a short assisted settle.
// Position and velocity are continuous, monotone, and land at zero speed.
// Normal spins use extra reel turns to sustain the fast cruise for longer.
const phases = [
  {time:0, position:0, velocity:1.6},
  {time:.42, position:.672, velocity:1.6},
  {time:.78, position:.9852, velocity:.14},
  {time:.90, position:.9964, velocity:.064},
  {time:1, position:1, velocity:0}
];

export function sampleMotion(progress) {
  const t = Math.max(0,Math.min(1,progress));
  if (t === 1) return {position:1,velocity:0};
  const index = phases.findIndex((phase,i) => i<phases.length-1 && t<phases[i+1].time);
  const a = phases[Math.max(0,index)], b = phases[Math.max(0,index)+1];
  const span = b.time-a.time, u = (t-a.time)/span;
  const position = (2*u**3-3*u**2+1)*a.position +
    (u**3-2*u**2+u)*span*a.velocity +
    (-2*u**3+3*u**2)*b.position + (u**3-u**2)*span*b.velocity;
  const velocity = ((6*u*u-6*u)*a.position +
    (3*u*u-4*u+1)*span*a.velocity +
    (-6*u*u+6*u)*b.position + (3*u*u-2*u)*span*b.velocity)/span;
  return {position,velocity:Math.max(0,velocity)};
}

export function reelKeyframes(target, length, reduced = false) {
  const samples = reduced ? 1 : 160;
  return Array.from({length:samples+1},(_,i) => {
    const offset = i/samples;
    const position = reduced ? offset : sampleMotion(offset).position;
    return {offset,transform:`translateY(-${target/length*100*position}%)`};
  });
}

// Approximate a short shutter exposure from actual row speed. Values are in
// original 640px artwork units; the caller scales them with the whole screen.
export function motionBlur(progress, rows, duration) {
  const pixelsPerSecond = sampleMotion(progress).velocity*rows*88/(duration/1000);
  return Math.min(14,pixelsPerSecond*.0055);
}