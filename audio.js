// Preload once, unlock within the spin gesture, and cue during the final slowdown.
// No promise callback plays sound: a slow/blocked load never creates a late Yay.
export function createWinnerSound({
  url = './assets/yay-third.wav',
  spinUrl = './assets/wheel-spin.wav',
  AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext,
  fetchAudio = async path => {
    // Canvas permits embedded media but blocks network connections, including
    // fetch(data:...). Decode inline bytes directly instead of invoking fetch.
    const inline = /^data:audio\/wav;base64,([A-Za-z0-9+/=\s]+)$/.exec(path);
    if (inline) return Uint8Array.from(atob(inline[1]), character => character.charCodeAt(0)).buffer;
    const response = await fetch(path);
    if (!response.ok) throw new Error('Winner sound could not be loaded');
    return response.arrayBuffer();
  },
  isVisible = () => document.visibilityState === 'visible',
  onStatus = () => {},
  onSpinStatus = () => {}
} = {}) {
  let context = null;
  let masterGain = null;
  let enabled = true;
  let volume = 1;
  let buffer = null;
  let source = null;
  let eligible = false;
  let spinBuffer = null;
  let spinSource = null;
  let spinGain = null;
  let spinEpoch = 0;
  let preparedAt = 0;
  let lastError = '';
  function report(message) {
    try { onStatus({ loaded: !!buffer, contextState: context?.state || 'unavailable', message, error: lastError }); }
    catch { /* Status presentation must not affect the picker. */ }
  }
  function reportError(message, error) {
    lastError = error?.message || String(error || '');
    report(message + (lastError ? ` (${lastError})` : ''));
  }
  const ready = (async () => {
    try {
      report('Loading winner sound…');
      if (!AudioContextClass) throw new Error('Web Audio is unavailable in this browser');
      context = new AudioContextClass();
      if (context.createGain) {
        masterGain = context.createGain();
        masterGain.gain.value = volume;
        masterGain.connect(context.destination);
      }
      const bytes = await fetchAudio(url);
      buffer = await context.decodeAudioData(bytes);
      report('Winner sound loaded. Spin to play, or use Test sound.');
      return true;
    } catch (error) {
      buffer = null;
      reportError('Winner sound could not load.', error);
      return false;
    }
  })();
  function reportSpin(message, error = '') {
    try { onSpinStatus({loaded:!!spinBuffer,message,error}); }
    catch { /* Diagnostic presentation cannot affect playback. */ }
  }
  const spinReady = (async () => {
    try {
      if (!spinUrl || !context) return false;
      reportSpin('Loading spinner sound…');
      spinBuffer = await context.decodeAudioData(await fetchAudio(spinUrl));
      reportSpin('Spinner sound loaded. It winds down with the reel.');
      return true;
    } catch (error) {
      spinBuffer = null;
      reportSpin('Spinner sound could not load.', error?.message || String(error));
      return false;
    }
  })();

  function stop() {
    const current = source;
    source = null;
    if (current) {
      try { current.stop(); } catch { /* Already ended. */ }
      try { current.disconnect(); } catch { /* Already disconnected. */ }
    }
  }
  function cancel() {
    eligible = false;
    stop();
    stopSpin();
  }
  function stopSpin() {
    spinEpoch++;
    const current = spinSource;
    const gain = spinGain;
    spinSource = spinGain = null;
    if (current) {
      try { current.stop(); } catch { /* Already ended. */ }
      try { current.disconnect(); } catch { /* Already disconnected. */ }
    }
    try { gain?.disconnect(); } catch { /* Already disconnected. */ }
  }
  function playSpin(offset = 0) {
    if (!enabled || volume === 0 || !spinBuffer || context?.state !== 'running' || !isVisible() || offset >= spinBuffer.duration) return false;
    let cue, gain;
    try {
      cue = context.createBufferSource();
      gain = context.createGain();
      cue.buffer = spinBuffer;
      gain.gain.value = .55;
      cue.connect(gain);
      gain.connect(masterGain || context.destination);
      cue.onended = () => {
        try { cue.disconnect(); gain.disconnect(); } catch { /* No-op. */ }
        if (spinSource === cue) spinSource = spinGain = null;
      };
      spinSource = cue;
      spinGain = gain;
      cue.start(0,offset);
      return true;
    } catch (error) {
      if (spinSource === cue) spinSource = spinGain = null;
      try { cue?.disconnect(); gain?.disconnect(); } catch { /* No-op. */ }
      reportSpin('Spinner sound could not play.',error?.message || String(error));
      return false;
    }
  }
  function startSpin(animation, duration, unlocked) {
    if (duration < 1000 || !spinBuffer) return;
    const epoch = spinEpoch;
    const begin = () => {
      const elapsed = Number(animation.currentTime) / 1000;
      // Never begin late or resurrect an old spin after backgrounding/cancel.
      if (epoch !== spinEpoch || !eligible || !isVisible() ||
          animation.playState !== 'running' || elapsed > .15 ||
          performance.now() - preparedAt > 150) return false;
      return playSpin(Math.max(0,elapsed));
    };
    if (context?.state === 'running') begin();
    else Promise.resolve(unlocked).then(ok => { if (ok) begin(); }).catch(() => {});
  }
  function prepare() {
    cancel();
    eligible = true;
    preparedAt = performance.now();
    if (!enabled || volume === 0) return Promise.resolve(false);
    try {
      if (!context || context.state === 'closed') {
        report('Sound is unavailable. Reload the page to try again.');
        return Promise.resolve(false);
      }
      // Called synchronously by the real user gesture, before awaiting animation.
      const resumed = Promise.resolve(context.resume()).then(() => context.state === 'running').catch(error => {
        reportError('The browser blocked sound. Try Test sound.', error);
        return false;
      });
      // Safari's audio session may need a source started during that gesture.
      // One silent sample unlocks the session; this is not the winner cue.
      const silent = context.createBufferSource();
      silent.buffer = context.createBuffer(1, 1, context.sampleRate);
      silent.connect(context.destination);
      silent.onended = () => { try { silent.disconnect(); } catch { /* No-op. */ } };
      silent.start();
      return resumed;
    } catch (error) {
      reportError('Sound could not start.', error);
      return Promise.resolve(false);
    }
  }
  function play() {
    const canPlay = eligible;
    eligible = false;
    if (!canPlay || !enabled || volume === 0 || !isVisible()) return false;
    if (!buffer) {
      report(lastError ? `Winner sound is unavailable. (${lastError})` : 'Winner sound is still loading. Try Test sound once it is ready.');
      return false;
    }
    if (context?.state !== 'running') {
      report(`Sound is ${context?.state || 'unavailable'}. Use Test sound to enable playback.`);
      return false;
    }
    let cue;
    try {
      stop();
      cue = context.createBufferSource();
      cue.buffer = buffer;
      cue.connect(masterGain || context.destination);
      cue.onended = () => {
        try { cue.disconnect(); } catch { /* No-op. */ }
        if (source === cue) source = null;
      };
      source = cue;
      cue.start();
      lastError = '';
      report('Playback started. If silent, check the browser/tab mute and your device volume.');
      return true;
    } catch (error) {
      if (source === cue) source = null;
      try { cue?.disconnect(); } catch { /* No-op. */ }
      reportError('Winner sound could not play.', error);
      return false;
    }
  }
  // Only this explicit diagnostic action awaits resume; winner playback never
  // waits for a late load/resume and cannot replay after a missed landing.
  async function test() {
    if (!buffer) {
      report(lastError ? `Winner sound is unavailable. (${lastError})` : 'Winner sound is still loading.');
      return false;
    }
    const resumed = prepare();
    if (!await resumed) return false;
    return play();
  }
  async function testSpin() {
    if (!spinBuffer) return false;
    const epochBefore = spinEpoch + 1;
    const resumed = prepare();
    if (!await resumed || spinEpoch !== epochBefore || !eligible || !isVisible()) return false;
    return playSpin();
  }
  function configure({sound = true, volume:percent = 100} = {}) {
    enabled = sound;
    volume = Math.max(0,Math.min(100,percent))/100;
    if (masterGain) masterGain.gain.value = enabled ? volume : 0;
    if (!enabled || volume === 0) cancel();
    if (!enabled) report('Sound effects are off. Enable them in Settings to use Test sound.');
    else if (volume === 0) report('Volume is at zero. Increase it in Settings to hear sound.');
  }
  return { ready, spinReady, prepare, play, startSpin, stopSpin, cancel, test, testSpin, configure };
}