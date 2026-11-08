import { STORAGE_KEY, MAX_PLAYERS, cleanName, loadPlayerState, gamePlayers, decodePlayers, encodePlayers, pickPlayer, createReel, createFlickReel, artifactLayout } from './logic.js';
import { createWinnerSound } from './audio.js';
import { reelKeyframes, motionBlur } from './motion.js';
import { SETTINGS_KEY, defaultSettings, decodeSettings, encodeSettings } from './settings.js';
import { initializeInstallGuide, runningAsApp, isIOSDevice } from './install.js';
import {attachReelGesture} from './gestures.js';

const $ = id => document.getElementById(id);
let players=[],samplesAllowed=true,appWindow=runningAsApp(),unreadableRoster=false;
let storageWarning = '';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  ({players,samplesAllowed}=loadPlayerState(saved));
} catch {
  unreadableRoster=true;
  storageWarning = 'Saved players could not be loaded. They have not been changed. Add or import a crew to replace them.';
}
let spinning = false;
let dragging = false;
let applyingUpdate = false;
let refreshUpdateStatus=()=>{};
let winner = null;
let deleted = null;
let toastTimer;
let settings = defaultSettings();
let preferencesWarning = '';
try {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved !== null) settings = decodeSettings(saved);
} catch { preferencesWarning = 'Preferences could not be loaded. Using defaults for this visit.'; }
let pendingImport = null;
const dialog = $('players-dialog');
const track = $('reel-track');
const winnerSound = createWinnerSound({
  getAudioSession:()=>isIOSDevice(navigator)?navigator.audioSession:undefined,
  onStatus({ loaded, message, error }) {
    $('audio-status').textContent = message;
    $('test-sound').disabled = !loaded || spinning || dragging || applyingUpdate;
    $('sound-error').textContent = error ? 'Sound unavailable — open Sound credits for details.' : '';
    $('sound-error').hidden = !error;
  },
  onSpinStatus({loaded,message,error}) {
    $('wheel-status').textContent = message + (error ? ` (${error})` : '');
    $('test-wheel').disabled = !loaded || spinning || dragging || applyingUpdate;
  }
});
winnerSound.configure(settings);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') winnerSound.cancel();
});
window.addEventListener('pagehide', () => winnerSound.cancel());

function persist() {
  samplesAllowed=false;
  unreadableRoster=false;
  try { localStorage.setItem(STORAGE_KEY, encodePlayers(players));storageWarning=''; }
  catch {
    storageWarning = 'Browser storage is unavailable. Changes last only until you close this page.';
    $('saved-note').textContent = storageWarning;
    $('toast-text').textContent = storageWarning;
    $('undo-delete').hidden = true;
    $('toast').hidden = false;
  }
}

function activePlayers() { return gamePlayers(players,{samplesAllowed,appWindow}); }
function usingSamples() { return !players.length&&samplesAllowed&&!appWindow; }
function allowRosterReplacement(){
  if(!unreadableRoster)return true;
  return confirm('Your saved player list could not be read. Replace it with a new crew? The unreadable saved list will be overwritten.');
}
function appWindowChanged(){
  if(spinning||dragging)return;
  const next=runningAsApp();
  if(next===appWindow)return;
  appWindow=next;winner=null;
  renderSummary();renderRestingReel();
}
for(const mode of ['standalone','minimal-ui','window-controls-overlay'])matchMedia(`(display-mode: ${mode})`).addEventListener('change',appWindowChanged);
function initials(name) { return Array.from(name.trim().split(/\s+/).map(word => Array.from(word)[0]).slice(0, 2)).join('').toUpperCase(); }
function reelName(name, selected = false) {
  const item = document.createElement('div');
  item.className = `reel-name${selected ? ' selected' : ''}`;
  if (name.length > 25) item.classList.add('long-name');
  item.textContent = name;
  return item;
}

function renderRestingReel() {
  const active = activePlayers();
  const center = Math.max(0, active.findIndex(player => player.id === winner?.id));
  track.replaceChildren();
  track.style.transform = 'translateY(-40%)';
  for (let i = -2; i <= 2; i++) {
    const name = active.length ? active[(center + i + active.length * 2) % active.length].name : i === 0 ? 'Everyone’s invited.' : '';
    track.append(reelName(name, i === 0));
  }
}

function renderSummary() {
  const active = activePlayers();
  $('top-count').textContent = active.length;
  $('table-list').replaceChildren();
  active.forEach((player, i) => {
    const item = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = `avatar avatar-${i % 6}`;
    avatar.textContent = initials(player.name);
    avatar.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.textContent = player.name;
    item.append(avatar, name);
    $('table-list').append(item);
  });
  if (!active.length) {
    const empty = document.createElement('li');
    empty.className = 'table-empty';
    empty.textContent = 'The table’s a little quiet. Add a player or switch someone in to get started.';
    $('table-list').append(empty);
  }
  $('spin-button').disabled = !active.length || spinning || dragging || applyingUpdate;
  for (const id of ['settings-open','sound-credits']) $(id).disabled = spinning || dragging || applyingUpdate;
  $('apply-update').disabled = spinning || dragging || applyingUpdate;
  $('test-sound').disabled = spinning || dragging || applyingUpdate || $('test-sound').dataset.loaded !== 'true';
  $('test-wheel').disabled = spinning || dragging || applyingUpdate || $('test-wheel').dataset.loaded !== 'true';
  $('spin-label').textContent = spinning ? 'Picking a player…' : usingSamples()?'Try a sample spin':'Who goes first?';
  $('odds').textContent = active.length > 1 ? `${active.length} players. Equal chances. No hard feelings.` : active.length === 1 ? 'One player in. A very good chance of winning.' : 'No players in yet. Manage players to fill the table.';
  $('ready-text').textContent = spinning ? 'PICKING A PLAYER' : active.length ? 'READY TO ROLL' : 'WAITING FOR PLAYERS';
  $('saved-note').textContent = storageWarning || (usingSamples()?'The reel is trying sample names. Add your own below—no sample players need removing.':'Your crew stays saved on this device.');
  $('export-players').disabled=unreadableRoster;
  $('storage-warning').textContent = storageWarning;
  const previewStorage = document.documentElement.dataset.preview === 'true' && storageWarning.includes('could not be loaded');
  $('storage-warning').hidden = !storageWarning || previewStorage;
  $('preview-storage-note').hidden = !previewStorage;
}

function updateAfterEdit() {
  winner = null;
  $('machine').classList.remove('is-winner');
  $('result').classList.remove('winner');
  $('result').textContent = activePlayers().length ? 'Your next first player is one spin away.' : 'Switch someone in, then give it a spin.';
  persist();
  renderSummary();
  renderRestingReel();
  renderRosterCount();
}

function renderRosterCount() {
  $('roster-count').textContent = `${players.filter(player=>player.active).length} in · ${players.length} saved`;
  $('select-all').disabled=!players.length;
  $('select-none').disabled=!players.length;
}

function renderRoster() {
  $('players-list').replaceChildren();
  renderRosterCount();
  players.forEach(player => {
    const row = document.createElement('li');
    row.className = 'player-row';
    const toggle = document.createElement('button');
    toggle.className = 'switch';
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', `${player.name} is playing`);
    toggle.setAttribute('aria-checked', player.active);
    toggle.addEventListener('click', () => {
      player.active = !player.active;
      toggle.setAttribute('aria-checked', player.active);
      updateAfterEdit();
    });
    const name = document.createElement('input');
    name.className = 'player-name';
    name.value = player.name;
    name.maxLength = 40;
    name.setAttribute('aria-label', `Name for ${player.name}`);
    name.addEventListener('change', () => {
      const cleaned = cleanName(name.value);
      if (!cleaned) {
        name.value = player.name;
        $('form-error').textContent = 'A player needs a name. Your previous name was kept.';
        return;
      }
      player.name = cleaned;
      name.value = cleaned;
      name.setAttribute('aria-label', `Name for ${cleaned}`);
      toggle.setAttribute('aria-label', `${cleaned} is playing`);
      remove.setAttribute('aria-label', `Remove ${cleaned}`);
      $('form-error').textContent = '';
      updateAfterEdit();
    });
    name.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); name.blur(); }
    });
    const remove = document.createElement('button');
    remove.className = 'remove-player';
    remove.type = 'button';
    remove.setAttribute('aria-label', `Remove ${player.name}`);
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>';
    remove.addEventListener('click', () => {
      const index = players.findIndex(p => p.id === player.id);
      deleted = { player: { ...player }, index };
      players.splice(index, 1);
      updateAfterEdit();
      renderRoster();
      const next = $('players-list').querySelectorAll('.remove-player')[Math.min(index, players.length - 1)];
      (next || $('new-name')).focus();
      $('toast-text').textContent = `${player.name} removed.`;
      $('undo-delete').hidden = false;
      $('toast').hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { $('toast').hidden = true; }, 10000);
    });
    row.append(toggle, name, remove);
    $('players-list').append(row);
  });
  if (!players.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-roster';
    empty.textContent = 'A fresh table. Add your first player above.';
    $('players-list').append(empty);
  }
  // The Undo action lives outside the native modal's inert subtree.
  // Move it into the modal while editing, then restore it on close.
  dialog.append($('toast'));
}

function openPlayers() {
  if (spinning||dragging||applyingUpdate) return;
  $('form-error').textContent = '';
  renderRoster();
  dialog.showModal();
  if(!players.length)$('new-name').focus();
}
$('manage-top').addEventListener('click', openPlayers);
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => dialog.close()));
dialog.addEventListener('close', () => { document.body.append($('toast')); $('manage-top').focus(); });

$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = cleanName($('new-name').value);
  if (!name) { $('form-error').textContent = 'A name needs more than spaces.'; return; }
  if (players.length >= MAX_PLAYERS) { $('form-error').textContent = 'This table seats 100. Remove someone before adding another player.'; return; }
  if(!allowRosterReplacement())return;
  players.push({ id: crypto.randomUUID(), name, active: true });
  $('new-name').value = '';
  $('form-error').textContent = '';
  updateAfterEdit();
  renderRoster();
  $('new-name').focus();
});
for (const [id, active] of [['select-all', true], ['select-none', false]]) {
  $(id).addEventListener('click', () => {
    if(!players.length)return;
    players.forEach(player => { player.active = active; });
    updateAfterEdit();
    renderRoster();
  });
}
$('undo-delete').addEventListener('click', () => {
  if (spinning || dragging || applyingUpdate || !deleted || players.length >= MAX_PLAYERS) return;
  players.splice(Math.min(deleted.index, players.length), 0, deleted.player);
  deleted = null;
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  updateAfterEdit();
  renderRoster();
});

async function startSpin(flick=null) {
  if (spinning || dragging || applyingUpdate || !activePlayers().length) return;
  const audioUnlocked = winnerSound.prepare();
  spinning = true;
  winner = null;
  $('machine').classList.remove('is-winner');
  $('machine').classList.add('is-spinning');
  $('result').classList.remove('winner');
  $('result').textContent = 'The suspense is part of the fun…';
  $('manage-top').disabled = true;
  $('undo-delete').disabled = true;
  renderSummary();
  let cueFrame;
  const setBlur = amount => {
    const scale = parseFloat(getComputedStyle(track.querySelector('.reel-name')).height)/88;
    $('reel-blur').setAttribute('stdDeviation',`${amount*scale*.035} ${amount*scale}`);
  };
  try {
    // Snapshot the same effective roster for selection and animation. Samples
    // never enter saved player storage or become editable crew records.
    const crew=activePlayers();
    const selected = pickPlayer(crew);
    const reduced = settings.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    // More travel lets the wheel hold its opening speed before a later brake,
    // rather than spending most of the fixed 3.2 seconds in a slow coast.
    const { names, target, start=0 } = flick
      ? createFlickReel(crew,selected.id,flick.position,flick.direction,reduced||crew.length===1?6:16)
      : createReel(crew, selected.id, reduced || crew.length === 1 ? 6 : 16);
    track.replaceChildren(...names.map(name => reelName(name)));
    track.style.transform = `translateY(-${start/names.length*100}%)`;
    // Percentages follow the track's responsive height throughout the spin,
    // keeping the same fractional row in view when orientation/size changes.
    const destination = `translateY(-${target / names.length * 100}%)`;
    const duration = reduced || crew.length === 1 ? 100 : 3200;
    const shortSpin = duration <= 100;
    const animation = track.animate(reelKeyframes(target,names.length,shortSpin,start), { duration, easing:'linear', fill:'forwards' });
    winnerSound.startSpin(animation,duration,audioUnlocked);
    if (!shortSpin) {
      // Blur follows animation time even while paused or resized.
      const checkCue = () => {
        if (animation.playState === 'idle' || animation.playState === 'finished') {
          setBlur(0);
          return;
        }
        const elapsed = Number(animation.currentTime) || 0;
        setBlur(motionBlur(elapsed/duration,Math.abs(target-start),duration));
        cueFrame = requestAnimationFrame(checkCue);
      };
      setBlur(motionBlur(0,Math.abs(target-start),duration));
      cueFrame = requestAnimationFrame(checkCue);
    }
    await animation.finished;
    track.style.transform = destination;
    animation.cancel();
    winner = selected;
    renderRestingReel();
    $('machine').classList.add('is-winner');
    $('result').classList.add('winner');
    $('result').textContent = `${winner.name} goes first!`;
    // No timing offset: cue once when the actual animation has finished.
    winnerSound.play();
  } catch {
    winnerSound.cancel();
    $('result').textContent = 'That spin didn’t finish. Give it another try.';
    renderRestingReel();
  } finally {
    cancelAnimationFrame(cueFrame);
    setBlur(0);
    winnerSound.stopSpin();
    spinning = false;
    appWindowChanged();
    $('machine').classList.remove('is-spinning');
    $('manage-top').disabled = false;
    $('undo-delete').disabled = false;
    renderSummary();
  }
}
$('spin-button').addEventListener('click',()=>{void startSpin();});
attachReelGesture({
  surface:$('reel-gesture'),
  canStart:()=>!spinning&&!applyingUpdate&&!document.querySelector('dialog[open]')&&activePlayers().length>0,
  startPose(){
    const crew=activePlayers(),position=Math.max(0,crew.findIndex(player=>player.id===winner?.id));
    return {position,rowHeight:track.firstElementChild?.getBoundingClientRect().height};
  },
  drawPose(position){
    const crew=activePlayers(),whole=Math.floor(position),fraction=position-whole;
    const mod=index=>((index%crew.length)+crew.length)%crew.length;
    track.replaceChildren(...Array.from({length:7},(_,i)=>reelName(crew[mod(whole+i-3)].name)));
    track.style.transform=`translateY(-${(3+fraction)/7*100}%)`;
  },
  restore(){appWindowChanged();renderRestingReel();},
  onLock(value){
    dragging=value;
    $('manage-top').disabled=value||spinning||applyingUpdate;
    $('undo-delete').disabled=value||spinning||applyingUpdate;
    renderSummary();
  },
  onRelease(pose){void startSpin(pose);}
});

$('sound-credits').addEventListener('click', () => $('credits-dialog').showModal());
$('close-credits').addEventListener('click', () => $('credits-dialog').close());
winnerSound.ready.then(loaded => {
  $('test-sound').dataset.loaded = String(loaded);
  $('test-sound').disabled = !loaded || spinning || dragging || applyingUpdate;
});
winnerSound.spinReady.then(loaded => {
  $('test-wheel').dataset.loaded = String(loaded);
  $('test-wheel').disabled = !loaded || spinning || dragging || applyingUpdate;
});
$('test-sound').addEventListener('click', () => {
  if (!spinning&&!dragging&&!applyingUpdate) void winnerSound.test();
});
$('test-wheel').addEventListener('click', () => {
  if (!spinning&&!dragging&&!applyingUpdate) void winnerSound.testSpin();
});
$('credits-dialog').addEventListener('close', () => {
  if (!spinning) winnerSound.cancel();
});
function renderSettings() {
  $('sound-enabled').checked = settings.sound;
  $('sound-volume').value = settings.volume;
  $('volume-value').textContent = `${settings.volume}%`;
  $('reduce-motion').checked = settings.motion === 'reduced';
  $('play-in-silent-mode').checked=settings.playInSilentMode;
  $('settings-save-status').textContent = preferencesWarning || 'Saved on this device.';
  document.documentElement.dataset.reduceMotion = String(settings.motion === 'reduced');
  winnerSound.configure(settings);
}
function saveSettings() {
  settings = {sound:$('sound-enabled').checked,volume:Number($('sound-volume').value),motion:$('reduce-motion').checked?'reduced':'system',playInSilentMode:$('play-in-silent-mode').checked};
  try {localStorage.setItem(SETTINGS_KEY,encodeSettings(settings));preferencesWarning='';}
  catch {preferencesWarning='Browser storage is unavailable. Preferences apply to this visit only.';}
  renderSettings();
}
for (const id of ['sound-enabled','sound-volume','reduce-motion','play-in-silent-mode']) $(id).addEventListener('input',saveSettings);
if(isIOSDevice(navigator)){
  $('silent-mode-help').hidden=false;
  $('silent-mode-row').hidden=false;
  let supported=false;
  try{supported=typeof navigator.audioSession?.type==='string';}catch{}
  $('play-in-silent-mode').disabled=!supported;
  if(!supported)$('silent-mode-option-help').textContent='Not available in this browser. Turn Silent Mode off to hear game sounds.';
}
$('settings-open').addEventListener('click',()=>{if(!spinning&&!dragging&&!applyingUpdate){renderSettings();refreshUpdateStatus();$('settings-dialog').showModal();}});
for (const id of ['settings-close','settings-done']) $(id).addEventListener('click',()=>$('settings-dialog').close());
document.querySelectorAll('dialog').forEach(modal=>{
  modal.addEventListener('click',event=>{
    if(event.target !== modal)return;
    const titlebarHeight=parseFloat(document.documentElement.style.getPropertyValue('--window-titlebar-height'))||0;
    if(document.documentElement.dataset.windowOverlay==='true'&&event.clientY<titlebarHeight)return;
    const bounds=modal.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)modal.close();
  });
});
$('export-players').addEventListener('click',()=>{
  if(unreadableRoster){
    $('backup-status').textContent='Your saved crew could not be read. No empty backup was exported.';
    return;
  }
  try {
    const blob=new Blob([encodePlayers(players)+'\n'],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download='who-goes-first-players.json';
    document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('backup-status').textContent='Player backup prepared. Keep the downloaded file somewhere safe.';
  } catch {$('backup-status').textContent='This browser could not download a backup.';}
});
$('import-players').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async()=>{
  const file=$('import-file').files[0];$('import-file').value='';
  if(!file)return;
  try {
    if(file.size>100000)throw new Error('Backup is too large.');
    pendingImport=decodePlayers(await file.text());
    $('import-summary').textContent=`Import ${pendingImport.length} saved player${pendingImport.length===1?'':'s'} (${pendingImport.filter(player=>player.active).length} playing)?`;
    $('import-dialog').showModal();
  } catch {
    pendingImport=null;
    $('backup-status').textContent='That file is not a valid Who Goes First? backup. Your current players were kept.';
  }
});
for(const id of ['import-cancel','import-keep']) $(id).addEventListener('click',()=>{
  pendingImport=null;
  $('import-dialog').close();
});
$('import-dialog').addEventListener('cancel',()=>{pendingImport=null;});
$('import-confirm').addEventListener('click',()=>{
  if(!pendingImport || spinning)return;
  players=pendingImport;pendingImport=null;
  // Undo belongs to the previous roster and must not reinsert stale IDs.
  deleted=null;
  clearTimeout(toastTimer);
  $('toast').hidden=true;
  updateAfterEdit();
  $('backup-status').textContent=`Imported ${players.length} player${players.length===1?'':'s'}.`;
  $('import-dialog').close();
});
$('import-dialog').addEventListener('close',()=>{
  // A queued close event from the preceding confirmation can arrive after the
  // next file has reopened this dialog. It must not erase that new import.
  if(!$('import-dialog').open)pendingImport=null;
});
renderSettings();
initializeInstallGuide();
// Spare height matters just as much as spare width: gold never extends into
// an unbounded tall-window backdrop. Keep the portrait face at most 640×920.
function updateArtifactFrame(){
  const root=document.documentElement,body=getComputedStyle(document.body);
  const horizontal=parseFloat(body.paddingLeft)+parseFloat(body.paddingRight);
  const vertical=parseFloat(body.paddingTop)+parseFloat(body.paddingBottom);
  const layout=artifactLayout(root.clientWidth-horizontal,root.clientHeight-vertical);
  root.dataset.artifactFramed=String(layout.framed);
  for(const[name,value]of Object.entries({
    '--artifact-width':layout.width,'--artifact-gutter':layout.gutter,'--artifact-block-space':layout.blockSpace
  }))root.style.setProperty(name,`${value}px`);
}
window.addEventListener('resize',updateArtifactFrame);
window.addEventListener('window-chrome-change',updateArtifactFrame);
updateArtifactFrame();
if(document.documentElement.dataset.preview==='true'){
  $('install-context').textContent='This is the embedded preview. Install the app from its published HTTPS website; installation and offline caching do not run inside Canvas.';
  $('offline-detail').textContent='Preview mode: installation and offline caching are available on the published website.';
}

function connectivity() { $('offline-status').textContent = navigator.onLine ? 'READY TO PLAY' : 'OFFLINE · READY TO PLAY'; }
window.addEventListener('online', connectivity);
window.addEventListener('offline', connectivity);
renderSummary();
renderRestingReel();
connectivity();
if ('serviceWorker' in navigator && document.documentElement.dataset.preview !== 'true') {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    let checkedAt=0,reloadAvailable=false,refused=false;
    let previousController=navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(applyingUpdate){location.reload();return;}
      const controller=navigator.serviceWorker.controller;
      if(previousController&&controller!==previousController)reloadAvailable=true;
      previousController=controller;
      updateAvailable();
    });
    function updateAvailable(){
      const ready=!!registration.waiting||reloadAvailable;
      $('settings-open').classList.toggle('update-ready',ready);
      $('settings-open').setAttribute('aria-label',ready?'Settings — update available':'Settings');
      $('apply-update').hidden=!ready&&!applyingUpdate;
      if(applyingUpdate)return;
      $('apply-update').textContent=reloadAvailable?'Reload updated app':refused&&ready?'Retry update':'Apply update';
      if(reloadAvailable)$('update-status').textContent='The update has finished downloading. Reload this window to use it. Your saved players will stay.';
      else if(!ready){
        refused=false;
        $('update-status').textContent='No update is waiting. You can keep playing.';
        $('update-status').classList.remove('update-attention');
      }
      else if(!refused)$('update-status').textContent='An update is ready. Apply it here without clearing your saved players or settings.';
    }
    refreshUpdateStatus=updateAvailable;
    function checkForUpdate(){
      if(!navigator.onLine||Date.now()-checkedAt<60000)return;
      checkedAt=Date.now();
      registration.update().then(updateAvailable).catch(()=>{});
    }
    updateAvailable();
    checkForUpdate();
    window.addEventListener('online',checkForUpdate);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkForUpdate();});
    $('apply-update').addEventListener('click',()=>{
      if(spinning||dragging||applyingUpdate)return;
      if(reloadAvailable){applyingUpdate=true;renderSummary();location.reload();return;}
      const worker=registration.waiting;
      if(!worker){updateAvailable();return;}
      applyingUpdate=true;
      renderSummary();
      $('manage-top').disabled=true;
      $('update-status').textContent='Applying update…';
      $('update-status').classList.add('update-attention');
      $('apply-update').textContent='Applying…';
      const channel=new MessageChannel();
      const timer=setTimeout(()=>{
        channel.port1.close();
        $('update-status').textContent='The update has not finished responding. To finish safely, close every Who Goes First? tab and installed window, then reopen the app. Your saved players and settings will stay.';
        $('apply-update').textContent='Reopen app to finish';
      },10000);
      function retry(message){
        clearTimeout(timer);channel.port1.close();
        applyingUpdate=false;
        $('manage-top').disabled=false;
        renderSummary();
        refused=true;
        updateAvailable();
        $('update-status').textContent=message;
      }
      channel.port1.onmessage=({data})=>{
        if(data?.status==='accepted')return;
        const count=Number.isInteger(data?.otherWindowCount)&&data.otherWindowCount>0?data.otherWindowCount:null;
        retry(data?.status==='other-windows'
          ? `Update paused — ${count?`${count} other ${count===1?'window or tab is':'windows or tabs are'}`:'another window or tab is'} still open. Close other Who Goes First? tabs and installed windows, then choose Retry update. Your saved players and settings will stay.`
          : 'The update could not be applied. Close all app windows and reopen to finish updating.');
      };
      try{worker.postMessage({type:'APPLY_UPDATE'},[channel.port2]);}
      catch{retry('The update is no longer waiting. Close all app windows and reopen to finish updating.');}
    });
    registration.addEventListener('updatefound',()=>{
      const worker=registration.installing;
      worker?.addEventListener('statechange',()=>{if(worker.state==='installed')updateAvailable();});
    });
    return navigator.serviceWorker.ready;
  }).then(() => {
    if (navigator.onLine) $('offline-status').textContent = 'READY FOR OFFLINE PLAY';
    $('offline-detail').textContent='Offline play is ready. The game, artwork, and sounds are saved on this device.';
  }).catch(() => {
    $('offline-status').textContent = 'ONLINE PLAY';
    $('offline-detail').textContent='Offline setup was unavailable. Use the HTTPS website in a supported browser and try again.';
  });
}