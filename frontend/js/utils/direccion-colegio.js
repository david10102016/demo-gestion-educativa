// js/utils/direccion-colegio.js
// Dirección propia por colegio: mariscal-sucre.vercel.app (o mariscal-sucre.tudominio.com más adelante).
// Se usa en el login (index.html) y en el QR de las credenciales. Sin dominios escritos a mano.

const ES_IP = /^\d{1,3}(\.\d{1,3}){3}$/
const esLocal = (h) => h === 'localhost' || ES_IP.test(h)

/** Nombre de colegio que trae la dirección actual (primer tramo), o null si no aplica */
export function subdominioActual(host = window.location.hostname) {
  const h = String(host).toLowerCase()
  if (esLocal(h)) return null
  const p = h.split('.')
  return p.length >= 3 ? p[0] : null
}

/** Dominio sin el primer tramo: colegio-buena-fe.vercel.app -> vercel.app */
function baseDe(host) {
  const p = String(host).toLowerCase().split('.')
  return p.length >= 3 ? p.slice(1).join('.') : p.join('.')
}

/**
 * Dirección a la que lleva el QR de un colegio.
 * Con subdominio asignado: https://<subdominio>.<dominio base>/index.html
 * Sin subdominio (o en localhost): <origen actual>/index.html?colegio=<id>
 */
export function urlDelColegio(colegio, loc = window.location) {
  const h = loc.hostname.toLowerCase()
  if (colegio?.subdominio && !esLocal(h)) {
    return `${loc.protocol}//${colegio.subdominio}.${baseDe(h)}${loc.port ? ':' + loc.port : ''}/index.html`
  }
  const base = `${loc.origin}/index.html`
  return colegio?.id ? `${base}?colegio=${encodeURIComponent(colegio.id)}` : base
}