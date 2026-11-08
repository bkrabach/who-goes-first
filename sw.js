const PREFIX = `who-goes-first:${self.registration.scope}:`;
const CACHE = PREFIX + 'v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './logic.js', './audio.js', './motion.js', './settings.js', './install.js', './manifest.webmanifest', './icons/who-goes-first-32.png', './icons/who-goes-first-192.png', './icons/who-goes-first-512.png', './icons/who-goes-first-1024.png', './icons/who-goes-first-maskable-512.png', './icons/who-goes-first-apple-180.png', './assets/shell-gold.png', './assets/reel-redrawn.png', './assets/players-label.png', './assets/spin-label.png', './assets/parchment-redrawn.png', './assets/yay-third.wav', './assets/wheel-spin.wav', './assets/audio-attribution.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(new URL(path, self.location), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if(event.data?.type!=='APPLY_UPDATE' || !event.source?.id || !event.ports[0])return;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const appWindows=windows.filter(client=>client.url.startsWith(self.registration.scope));
    if(!appWindows.some(client=>client.id===event.source.id))return;
    if(appWindows.some(client=>client.id!==event.source.id)){
      event.ports[0].postMessage({status:'other-windows'});
      return;
    }
    event.ports[0].postMessage({status:'accepted'});
    await self.skipWaiting();
  })().catch(()=>event.ports[0].postMessage({status:'failed'})));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    // Keep HTML and modules from the same release. A new worker waits for old
    // tabs to close before activating, so a spin is never interrupted by update.
    event.respondWith(caches.open(CACHE).then(cache => cache.match('./index.html')).then(cached => cached || fetch(event.request)));
    return;
  }
  const allowed = new Set(SHELL.map(path => new URL(path, self.location).href));
  if (allowed.has(event.request.url)) event.respondWith(caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request)));
});