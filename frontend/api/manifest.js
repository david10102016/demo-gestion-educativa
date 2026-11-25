// frontend/api/manifest.js
// Manifiesto PWA por colegio: nombre, sigla, color y logo salen de la base (colegio_por_subdominio).
// Sin dirección propia o si falla la consulta, devuelve un manifiesto neutro.

const ES_IP = /^\d{1,3}(\.\d{1,3}){3}$/

function subdominioDe(host) {
  const h = String(host || '').toLowerCase().split(':')[0]
  if (h === 'localhost' || ES_IP.test(h)) return null
  const p = h.split('.')
  return p.length >= 3 ? p[0] : null
}

function tipoImagen(url) {
  const ext = String(url).split('?')[0].split('.').pop().toLowerCase()
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  return 'image/jpeg'
}

const NEUTRO = {
  name: 'Gestión Educativa',
  short_name: 'Gestión Educativa',
  description: 'Sistema de Gestión Educativa',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#020810',
  theme_color: '#4f46e5',
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' }
  ]
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')

  let manifiesto = NEUTRO
  try {
    const sub = subdominioDe(req.headers['x-forwarded-host'] || req.headers.host)
    const url = process.env.VITE_SUPABASE_URL
    const anon = process.env.VITE_SUPABASE_ANON_KEY
    if (sub && url && anon) {
      const r = await fetch(`${url}/rest/v1/rpc/colegio_por_subdominio`, {
        method: 'POST',
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p: sub })
      })
      if (r.ok) {
        const filas = await r.json()
        const c = Array.isArray(filas) ? filas[0] : filas
        if (c && c.nombre) {
          const sigla = c.sigla || c.nombre
          const iconos = c.logo_url
            ? [
                { src: c.logo_url, sizes: '192x192', type: tipoImagen(c.logo_url), purpose: 'any' },
                { src: c.logo_url, sizes: '512x512', type: tipoImagen(c.logo_url), purpose: 'any' }
              ]
            : NEUTRO.icons
          manifiesto = {
            ...NEUTRO,
            name: c.nombre,
            short_name: String(sigla).slice(0, 12),
            description: `Plataforma educativa de ${c.nombre}`,
            theme_color: c.color_primario || NEUTRO.theme_color,
            icons: iconos
          }
        }
      }
    }
  } catch (_) { /* cae al manifiesto neutro */ }

  res.status(200).send(JSON.stringify(manifiesto))
}
