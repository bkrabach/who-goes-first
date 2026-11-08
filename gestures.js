// The reel is an optional direct-manipulation surface. Semantic button/keyboard
// selection remains available, and gestures never determine the random winner.
export function attachReelGesture({surface,canStart,startPose,drawPose,restore,onLock,onRelease}){
  let gesture=null;
  const releaseCapture=id=>{try{if(surface.hasPointerCapture(id))surface.releasePointerCapture(id);}catch{}};
  function cancel(){
    if(!gesture)return;
    const previous=gesture;gesture=null;
    releaseCapture(previous.id);
    surface.classList.remove('is-dragging');
    if(previous.moved){onLock(false);restore();}
  }
  surface.addEventListener('pointerdown',event=>{
    if(gesture){if(event.pointerId!==gesture.id)cancel();return;}
    if(!event.isPrimary||(event.pointerType==='mouse'&&event.button!==0)||!canStart())return;
    const pose=startPose();
    if(!pose||!Number.isFinite(pose.rowHeight)||pose.rowHeight<=0)return;
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,lastY:event.clientY,time:event.timeStamp,velocity:0,moved:false,position:pose.position,pose};
    try{surface.setPointerCapture(event.pointerId);}catch{cancel();}
  });
  surface.addEventListener('pointermove',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    if(!gesture.moved&&!canStart()){cancel();return;}
    const dy=event.clientY-gesture.y,dx=event.clientX-gesture.x;
    if(!gesture.moved){
      if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){cancel();return;}
      if(Math.abs(dy)<8)return;
      gesture.moved=true;onLock(true);surface.classList.add('is-dragging');
    }
    event.preventDefault();
    const elapsed=event.timeStamp-gesture.time;
    if(elapsed>0)gesture.velocity=(event.clientY-gesture.lastY)/elapsed;
    gesture.lastY=event.clientY;gesture.time=event.timeStamp;
    gesture.position=gesture.pose.position-dy/gesture.pose.rowHeight;
    drawPose(gesture.position);
  });
  surface.addEventListener('pointerup',event=>{
    if(!gesture||event.pointerId!==gesture.id)return;
    const ended=gesture;gesture=null;
    releaseCapture(ended.id);surface.classList.remove('is-dragging');
    if(ended.moved)onLock(false);
    const dy=event.clientY-ended.y;
    if(!ended.moved)return;
    if(Math.abs(dy)<8){restore();return;}
    const position=ended.pose.position-dy/ended.pose.rowHeight;
    const recent=event.timeStamp-ended.time<100&&Math.abs(ended.velocity)>.05;
    const direction=(recent?ended.velocity:dy)>0?-1:1;
    // onRelease is synchronous up to AudioContext.prepare() inside startSpin,
    // retaining the trusted release gesture for browsers' audio unlock rules.
    onRelease({position,direction});
  });
  for(const name of ['pointercancel','lostpointercapture'])surface.addEventListener(name,event=>{
    if(event.pointerId===gesture?.id)cancel();
  });
  document.addEventListener('pointerdown',event=>{
    if(gesture&&event.pointerId!==gesture.id)cancel();
  },true);
  window.addEventListener('blur',cancel);
  window.addEventListener('pagehide',cancel);
  window.addEventListener('resize',cancel);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')cancel();});
  return {cancel};
}