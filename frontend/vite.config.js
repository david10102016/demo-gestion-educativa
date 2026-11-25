// build config
import { defineConfig, loadEnv } from 'vite'

// Despliegue de cuentas de prueba (VITE_MODO_DEMO=true): tarjeta para WhatsApp y redes (Open Graph)
// en la página de entrada. En producción no se agrega nada.
function tarjetaDemo(env) {
  const esc = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const sitio = String(env.VITE_SITE_URL || '').replace(/\/+$/, '')
  const titulo = env.VITE_OG_TITULO || 'Gestión Educativa — Demo'
  const texto = env.VITE_OG_DESCRIPCION || 'Prueba gratis el sistema de tu colegio: notas, asistencia, tareas, comunicados y pagos en un solo lugar.'
  const imagen = sitio ? `${sitio}/og-demo.png` : '/og-demo.png'
  return {
    name: 'tarjeta-demo',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (env.VITE_MODO_DEMO !== 'true' || !/index\.html$/.test(ctx.filename || ctx.path || '')) return html
        const meta = [
          `<meta name="description" content="${esc(texto)}">`,
          `<meta property="og:type" content="website">`,
          `<meta property="og:site_name" content="Gestión Educativa">`,
          `<meta property="og:title" content="${esc(titulo)}">`,
          `<meta property="og:description" content="${esc(texto)}">`,
          `<meta property="og:image" content="${esc(imagen)}">`,
          `<meta property="og:image:width" content="1200">`,
          `<meta property="og:image:height" content="630">`,
          `<meta property="og:locale" content="es_BO">`,
          `<meta name="twitter:card" content="summary_large_image">`,
          `<meta name="robots" content="noindex, nofollow">`,
        ].join('\n  ')
        return html
          .replace(/<title>[^<]*<\/title>/, `<title>${esc(titulo)}</title>`)
          .replace('</head>', `  ${meta}\n</head>`)
      },
    },
  }
}

export default defineConfig(({ mode }) => ({
  root: '.',
  plugins: [tarjetaDemo(loadEnv(mode, process.cwd(), 'VITE_'))],
  build: {
    target: 'esnext',
    outDir: 'dist',
    rollupOptions: {
      input: {
        regente: 'dashboard-regente.html',
        main:             'index.html',
        director:         'dashboard-director.html',
        profesor:         'dashboard-profesor.html',
        estudiante:       'dashboard-estudiante.html',
        'registro-tutor': 'registro-tutor.html',
        tutor:            'dashboard-tutor.html',
        secretaria:       'dashboard-secretaria.html',
        superadmin:       'dashboard-superadmin.html',
      }
    }
  },
  server: {
    port: 3000,
    open: true
  }
}))
