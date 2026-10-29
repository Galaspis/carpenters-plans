// Offline cache: the whole app shell is cached on first visit; later visits work without reception.
// Network-first for app files (so updates arrive when online), cache-first for the big vendor libs.
const VERSION = 'cp-v80';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './brand/favicon.svg',
  './brand/woody-header.svg', './brand/favicon.svg', './brand/fonts/Heebo.ttf', './brand/fonts/NunitoSans.ttf',
  './brand/icons/assembly.svg', './brand/icons/back-rtl.svg', './brand/icons/check.svg', './brand/icons/cutting.svg', './brand/icons/dimensions.svg', './brand/icons/drilling.svg', './brand/icons/exploded.svg', './brand/icons/export.svg', './brand/icons/fit-view.svg', './brand/icons/home.svg', './brand/icons/joinery.svg', './brand/icons/measure-tape.svg', './brand/icons/next-rtl.svg', './brand/icons/overview.svg', './brand/icons/parts.svg', './brand/icons/pdf.svg', './brand/icons/pencil.svg', './brand/icons/project-new.svg', './brand/icons/project-open.svg', './brand/icons/rotate.svg', './brand/icons/save.svg', './brand/icons/screw.svg', './brand/icons/search.svg', './brand/icons/settings.svg', './brand/icons/shopping.svg', './brand/icons/space.svg', './brand/icons/view-front.svg', './brand/icons/view-side.svg', './brand/icons/view-top.svg', './brand/icons/wood.svg', './brand/icons/zoom-in.svg', './brand/icons/zoom-out.svg',
  './js/app.js', './js/model.js', './js/expr.js', './js/joints.js', './js/parts.js', './js/cutlist.js',
  './js/bom.js', './js/assembly.js', './js/render.js', './js/icons.js', './js/viewer.js', './js/fit.js',
  './catalog/default-catalog.json', './designs/index.json',
  './designs/potting-bench.json', './designs/irrigation-cabinet.json', './designs/rolling-table.json', './designs/planter-box.json', './designs/shelf-unit.json', './designs/pergola-leanto.json', './designs/crosscut-jig.json', './designs/garden-workbench.json',
  './saw/', './saw/index.html', './saw/saw.js',
  './vendor/gallab-store.js', './vendor/three/three.module.js', './vendor/three/OrbitControls.js', './vendor/three/SVGRenderer.js', './vendor/renderers/Projector.js',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const vendor = url.pathname.includes('/vendor/');
  e.respondWith(vendor
    ? caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; }))
    : fetch(e.request).then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});
