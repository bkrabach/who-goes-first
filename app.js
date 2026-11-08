import { STORAGE_KEY, MAX_PLAYERS, cleanName, defaultPlayers, decodePlayers, encodePlayers, pickPlayer, createReel } from './logic.js';
import { createWinnerSound } from './audio.js';
import { reelKeyframes, motionBlur } from './motion.js';
import { SETTINGS_KEY, defaultSettings, decodeSettings, encodeSettings } from './settings.js';

const $ = id => document.getElementById(id);
let players;
let storageWarning = '';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  players = saved === null ? defaultPlayers() : decodePlayers(saved);
} catch {
  players = defaultPlayers();
  storageWarning = 'Saved players could not be loaded. Showing the original demo crew.';
}
let spinning = false;
let applyingUpdate = false;
let winner = null;
let deleted = null;
let toastTimer;
let installPrompt;
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
  onStatus({ loaded, message, error }) {
    $('audio-status').textContent = message;
    $('test-sound').disabled = !loaded || spinning;
    $('sound-error').textContent = error ? 'Sound unavailable — open Sound credits for details.' : '';
    $('sound-error').hidden = !error;
  },
  onSpinStatus({loaded,message,error}) {
    $('wheel-status').textContent = message + (error ? ` (${error})` : '');
    $('test-wheel').disabled = !loaded || spinning;
  }
});
winnerSound.configure(settings);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') winnerSound.cancel();
});
window.addEventListener('pagehide', () => winnerSound.cancel());

function persist() {
  try { localStorage.setItem(STORAGE_KEY, encodePlayers(players)); }
  catch {
    storageWarning = 'Browser storage is unavailable. Changes last only until you close this page.';
    $('saved-note').textContent = storageWarning;
    $('toast-text').textContent = storageWarning;
    $('undo-delete').hidden = true;
    $('toast').hidden = false;
  }
}

function activePlayers() { return players.filter(player => player.active); }
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
  $('spin-button').disabled = !active.length || spinning || applyingUpdate;
  for (const id of ['settings-open','sound-credits']) $(id).disabled = spinning || applyingUpdate;
  $('apply-update').disabled = spinning || applyingUpdate;
  $('test-sound').disabled = spinning || $('test-sound').dataset.loaded !== 'true';
  $('test-wheel').disabled = spinning || $('test-wheel').dataset.loaded !== 'true';
  $('spin-label').textContent = spinning ? 'Picking a player…' : 'Who goes first?';
  $('odds').textContent = active.length > 1 ? `${active.length} players. Equal chances. No hard feelings.` : active.length === 1 ? 'One player in. A very good chance of winning.' : 'No players in yet. Manage players to fill the table.';
  $('ready-text').textContent = spinning ? 'PICKING A PLAYER' : active.length ? 'READY TO ROLL' : 'WAITING FOR PLAYERS';
  $('saved-note').textContent = storageWarning || '↳ Your crew stays saved on this device.';
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

function renderRosterCount() { $('roster-count').textContent = `${activePlayers().length} in · ${players.length} saved`; }

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
  if (spinning) return;
  $('form-error').textContent = '';
  renderRoster();
  dialog.showModal();
}
$('manage-top').addEventListener('click', openPlayers);
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => dialog.close()));
dialog.addEventListener('close', () => { document.body.append($('toast')); $('manage-top').focus(); });
dialog.addEventListener('click', event => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });

$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = cleanName($('new-name').value);
  if (!name) { $('form-error').textContent = 'A name needs more than spaces.'; return; }
  if (players.length >= MAX_PLAYERS) { $('form-error').textContent = 'This table seats 100. Remove someone before adding another player.'; return; }
  players.push({ id: crypto.randomUUID(), name, active: true });
  $('new-name').value = '';
  $('form-error').textContent = '';
  updateAfterEdit();
  renderRoster();
  $('new-name').focus();
});
for (const [id, active] of [['select-all', true], ['select-none', false]]) {
  $(id).addEventListener('click', () => {
    players.forEach(player => { player.active = active; });
    updateAfterEdit();
    renderRoster();
  });
}
$('undo-delete').addEventListener('click', () => {
  if (spinning || !deleted || players.length >= MAX_PLAYERS) return;
  players.splice(Math.min(deleted.index, players.length), 0, deleted.player);
  deleted = null;
  clearTimeout(toastTimer);
  $('toast').hidden = true;
  updateAfterEdit();
  renderRoster();
});

$('spin-button').addEventListener('click', async () => {
  if (spinning || applyingUpdate || !activePlayers().length) return;
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
    const selected = pickPlayer(players);
    const reduced = settings.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    // More travel lets the wheel hold its opening speed before a later brake,
    // rather than spending most of the fixed 3.2 seconds in a slow coast.
    const { names, target } = createReel(activePlayers(), selected.id, reduced || activePlayers().length === 1 ? 6 : 16);
    track.replaceChildren(...names.map(name => reelName(name)));
    track.style.transform = 'translateY(0)';
    // Percentages follow the track's responsive height throughout the spin,
    // keeping the same fractional row in view when orientation/size changes.
    const destination = `translateY(-${target / names.length * 100}%)`;
    const duration = reduced || activePlayers().length === 1 ? 100 : 3200;
    const shortSpin = duration <= 100;
    const animation = track.animate(reelKeyframes(target,names.length,shortSpin), { duration, easing:'linear', fill:'forwards' });
    winnerSound.startSpin(animation,duration,audioUnlocked);
    if (!shortSpin) {
      // Blur follows animation time even while paused or resized.
      const checkCue = () => {
        if (animation.playState === 'idle' || animation.playState === 'finished') {
          setBlur(0);
          return;
        }
        const elapsed = Number(animation.currentTime) || 0;
        setBlur(motionBlur(elapsed/duration,target,duration));
        cueFrame = requestAnimationFrame(checkCue);
      };
      setBlur(motionBlur(0,target,duration));
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
    $('machine').classList.remove('is-spinning');
    $('manage-top').disabled = false;
    $('undo-delete').disabled = false;
    renderSummary();
  }
});

$('install-help').addEventListener('click', () => $('install-dialog').showModal());
$('sound-credits').addEventListener('click', () => $('credits-dialog').showModal());
$('close-credits').addEventListener('click', () => $('credits-dialog').close());
winnerSound.ready.then(loaded => {
  $('test-sound').dataset.loaded = String(loaded);
  $('test-sound').disabled = !loaded || spinning;
});
winnerSound.spinReady.then(loaded => {
  $('test-wheel').dataset.loaded = String(loaded);
  $('test-wheel').disabled = !loaded || spinning;
});
$('test-sound').addEventListener('click', () => {
  if (!spinning) void winnerSound.test();
});
$('test-wheel').addEventListener('click', () => {
  if (!spinning) void winnerSound.testSpin();
});
$('credits-dialog').addEventListener('close', () => {
  if (!spinning) winnerSound.cancel();
});
function renderSettings() {
  $('sound-enabled').checked = settings.sound;
  $('sound-volume').value = settings.volume;
  $('volume-value').textContent = `${settings.volume}%`;
  $('reduce-motion').checked = settings.motion === 'reduced';
  $('settings-save-status').textContent = preferencesWarning || 'Saved on this device.';
  document.documentElement.dataset.reduceMotion = String(settings.motion === 'reduced');
  winnerSound.configure(settings);
}
function saveSettings() {
  settings = {sound:$('sound-enabled').checked,volume:Number($('sound-volume').value),motion:$('reduce-motion').checked?'reduced':'system'};
  try {localStorage.setItem(SETTINGS_KEY,encodeSettings(settings));preferencesWarning='';}
  catch {preferencesWarning='Browser storage is unavailable. Preferences apply to this visit only.';}
  renderSettings();
}
for (const id of ['sound-enabled','sound-volume','reduce-motion']) $(id).addEventListener('input',saveSettings);
$('settings-open').addEventListener('click',()=>{if(!spinning){renderSettings();$('settings-dialog').showModal();}});
for (const id of ['settings-close','settings-done']) $(id).addEventListener('click',()=>$('settings-dialog').close());
document.querySelectorAll('dialog').forEach(modal=>{
  modal.addEventListener('click',event=>{
    if(event.target !== modal)return;
    const bounds=modal.getBoundingClientRect();
    if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)modal.close();
  });
});
$('export-players').addEventListener('click',()=>{
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
document.querySelectorAll('.close-install').forEach(button => button.addEventListener('click', () => $('install-dialog').close()));
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('install-button').hidden = false; });
$('install-button').addEventListener('click', async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-button').hidden = true;
});
window.addEventListener('appinstalled', () => { $('install-help').hidden = true; $('install-dialog').close(); });
const standalone=matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
if(standalone){$('install-help').textContent='Installation help';$('install-context').textContent='You’re running the installed app. Your players and settings stay saved in this browser’s app storage.';}
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
    let checkedAt=0;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(applyingUpdate)location.reload();
    });
    function updateAvailable(){
      if(!registration.waiting)return;
      $('settings-open').classList.add('update-ready');
      $('settings-open').setAttribute('aria-label','Settings — update available');
      $('apply-update').hidden=false;
      if(!applyingUpdate)$('update-status').textContent='An update is ready. Apply it here without clearing your saved players or settings.';
    }
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
      if(spinning||applyingUpdate||!registration.waiting)return;
      applyingUpdate=true;
      renderSummary();
      $('manage-top').disabled=true;
      $('update-status').textContent='Applying update…';
      const channel=new MessageChannel();
      const timer=setTimeout(()=>{
        channel.port1.close();
        $('update-status').textContent='Update is still pending. Close all app tabs and installed windows, then reopen. Your saved players will stay.';
      },10000);
      function retry(message){
        clearTimeout(timer);channel.port1.close();
        applyingUpdate=false;
        $('manage-top').disabled=false;
        renderSummary();
        $('update-status').textContent=message;
      }
      channel.port1.onmessage=({data})=>{
        if(data?.status==='accepted')return;
        retry(data?.status==='other-windows'
          ? 'Close other Who Goes First? tabs and installed windows, then try Apply update again. Your saved players will stay.'
          : 'The update could not be applied. Close all app windows and reopen to finish updating.');
      };
      try{registration.waiting.postMessage({type:'APPLY_UPDATE'},[channel.port2]);}
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