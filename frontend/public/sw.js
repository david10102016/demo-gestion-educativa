const CACHE = 'buenafe-v14'

// Se guardan respuestas completas (200) y las opacas de otros dominios (CDN sin crossorigin, status 0).
// Las parciales (206: video/audio con Range) y las de error no se guardan: Cache.put() rechaza las 206.
function guardar(req, res) {
  if (req.method !== 'GET' || !res || !(res.status === 200 || res.type === 'opaque')) return
  const clone = res.clone()
  caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {})
}

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  const req = e.request
  const isHTML = req.mode === 'navigate'
  const isSupabase = req.url.includes('supabase.co')

  if (isHTML) {
    e.respondWith(
      fetch(req)
        .then(res => { guardar(req, res); return res })
        .catch(() => caches.match(req))
    )
    return
  }

  // Supabase: directo a la red, sin guardar. Las copias sin conexión las maneja la app
  // (IndexedDB, separadas por usuario y borradas al cerrar sesión); aquí se guardaban
  // por URL, sin distinguir usuario, y quedaban en el dispositivo después del logout.
  if (isSupabase) return

  e.respondWith(
    caches.match(req).then(cached => cached ||
      fetch(req).then(res => { guardar(req, res); return res })
    )
  )
})
