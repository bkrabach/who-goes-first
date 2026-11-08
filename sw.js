const PREFIX = `who-goes-first:${self.registration.scope}:`;
const CACHE = PREFIX + 'v1';
const SHELL = ['./', './index.html', './styles.css', './app.js', './logic.js', './audio.js', './motion.js', './settings.js', './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable.png', './icons/apple-touch-icon.png', './assets/shell-gold.png', './assets/machine-frame.png', './assets/players-label.png', './assets/spin-label.png', './assets/parchment-texture.png', './assets/yay-third.wav', './assets/wheel-spin.wav', './assets/audio-attribution.txt'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL.map(path => new Request(new URL(path, self.location), { cache: 'reload' })))));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
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