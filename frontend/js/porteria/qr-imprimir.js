// js/porteria/qr-imprimir.js
// PDF de credenciales QR — diseño 4, ajustado para impresión (tamaño tarjeta 85,6 × 54 mm):
//   · VERTICAL (por defecto): 54 × 85,6 mm, 9 por hoja carta (3 × 3)
//   · HORIZONTAL (opcional):  85,6 × 54 mm, 10 por hoja carta (2 × 5)
//   · Franjas en tono claro del color del colegio, con onda y filo en el color: TODO el texto en negro y negrita
//   · Nombre del colegio en 2 filas, tamaño automático (máx. 10 pt) · gestión
//   · Escudo del colegio en el lugar de la foto (si se incluyen fotos y el estudiante la tiene, va la foto)
//   · Nombre: apellidos arriba y nombres abajo · curso · QR de asistencia +20 % (vectorial, corrección media)
//   · Usuario de acceso (correo) con ícono, negrita, una línea, SIN contraseña
//   · Franja inferior "CREDENCIAL ESCOLAR" · líneas de corte punteadas
// Reutiliza pdfmake que ya carga dashboard-director.html. El logo se incrusta una sola vez.

const MM = 72 / 25.4                     // puntos por milímetro
const CARTA = { w: 612, h: 792 }
const OSCURO = '#0f172a'
const FORMATOS = {
  vertical:   { w: 54 * MM,   h: 85.6 * MM, cols: 3, filas: 3 },
  horizontal: { w: 85.6 * MM, h: 54 * MM,   cols: 2, filas: 5 },
}

/** Descarga una imagen pública y la convierte en dataURL (null si falla) */
async function imagenDataUrl(url) {
  if (!url) return null
  try {
    const res = await fetch(url, { mode: 'cors' })
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => ok(null); r.readAsDataURL(blob) })
  } catch { return null }
}

const colorValido = (c) => (/^#[0-9a-f]{6}$/i.test(c ?? '') ? c : '#1573a2')
// Tono claro del color del colegio (para franjas: el texto negro encima se imprime nítido)
function tinte(hex, k = 0.16) {
  const n = parseInt(hex.slice(1), 16), mezcla = (v) => Math.round(255 - (255 - v) * k)
  return '#' + [n >> 16, (n >> 8) & 255, n & 255].map(v => mezcla(v).toString(16).padStart(2, '0')).join('')
}
const NEGRO = '#0b1220'
// pdfmake dibuja el QR con módulos de tamaño ENTERO (floor(fit / n)), así que el QR real sale más chico que "fit"
// y queda pegado arriba. Calculamos el lado real (modo byte, corrección M) para centrarlo y aprovechar el espacio.
const CAP_M = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287, 331, 362, 412]
function ladoQR(codigo, maximo) {
  const bytes = new TextEncoder().encode(String(codigo ?? '')).length
  const v = Math.max(1, CAP_M.findIndex(c => c >= bytes) + 1 || CAP_M.length)
  const n = 17 + 4 * v, modulo = Math.max(1, Math.floor(maximo / n))
  return n * modulo
}

const CINTA = 7   // alto (pt) de la cinta sólida del color del colegio arriba (≈2,5 mm); 0 = sin cinta

// Ancho estimado de un texto (Roboto Bold): mayúsculas ≈ 0.62 em, minúsculas/correo ≈ 0.56 em
const anchoTexto = (t, fs, f = 0.62) => String(t ?? '').length * fs * f
// Tamaño de letra que hace entrar el texto en el ancho, sin pasar del máximo ni bajar del mínimo
const ajustar = (t, max, ancho, f = 0.62, min = 4) => Math.max(min, Math.min(max, ancho / Math.max(1, String(t ?? '').length * f)))

// Parte un texto en 2 filas de largo parejo, cortando entre palabras
function dosFilas(texto) {
  const p = String(texto ?? '').split(/\s+/).filter(Boolean)
  if (p.length < 2) return [p.join(' '), '']
  let mejor = 1, dif = Infinity
  for (let i = 1; i < p.length; i++) {
    const d = Math.abs(p.slice(0, i).join(' ').length - p.slice(i).join(' ').length)
    if (d < dif) { dif = d; mejor = i }
  }
  return [p.slice(0, mejor).join(' '), p.slice(mejor).join(' ')]
}
// Nombre del estudiante: apellidos (2 primeras palabras) arriba, nombres abajo
function filasNombre(nombre) {
  const p = String(nombre ?? '').split(/\s+/).filter(Boolean)
  if (p.length <= 2) return [p.join(' '), '']
  return [p.slice(0, 2).join(' '), p.slice(2).join(' ')]
}

// Nodo con posición absoluta; si trae ancho, se envuelve en columnas para que el texto respete el ancho
function en(x, y, nodo) {
  if (nodo.text !== undefined && nodo.width) {
    const { width, ...resto } = nodo
    return { absolutePosition: { x, y }, columns: [{ width, ...resto }] }
  }
  return { ...nodo, absolutePosition: { x, y } }
}

function fondoSvg(w, h, alto, C) {
  const T = tinte(C)
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
  <rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="6" fill="#ffffff" stroke="${C}" stroke-width="2.6"/>
  <path d="M1.5 7.5a6 6 0 0 1 6-6h${w - 15}a6 6 0 0 1 6 6V${alto - 6}Q${w * 0.55} ${alto + 4} 1.5 ${alto - 1}z" fill="${T}"/>
  <path d="M1.5 ${alto - 1}Q${w * 0.55} ${alto + 4} ${w - 1.5} ${alto - 6}" fill="none" stroke="${C}" stroke-width="2.8"/>${CINTA ? `
  <path d="M1.5 7.5a6 6 0 0 1 6-6h${w - 15}a6 6 0 0 1 6 6V${CINTA}H1.5z" fill="${C}"/>` : ''}
  <path d="M1.5 ${h - 14}h${w - 3}v6.5a6 6 0 0 1-6 6h${-(w - 15)}a6 6 0 0 1-6-6z" fill="${T}"/>
  <path d="M1.5 ${h - 14}h${w - 3}" stroke="${C}" stroke-width="2.8"/>
</svg>`
}
const marcoSvg = (w, h, C) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4" fill="#ffffff" stroke="${C}" stroke-width="1.6"/></svg>`
const vacioSvg = (w, h) => `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" fill="#f8fafc" stroke="#94a3b8" stroke-width=".6" stroke-dasharray="2 2"/><text x="${w / 2}" y="${h / 2 + 2}" font-size="6" fill="#94a3b8" text-anchor="middle">FOTO</text></svg>`
// Ícono de usuario (login)
const iconoSvg = (C) => `<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="5" r="3" fill="${C}"/><path d="M2 15c0-4 3-6 6-6s6 2 6 6z" fill="${C}"/></svg>`

// Encabezado: nombre del colegio en 2 filas (negro, negrita) + gestión, a todo el ancho
function encabezado(x, y, ancho, ctx, max) {
  const [l1, l2] = dosFilas(ctx.colegio)
  const fs = Math.min(ajustar(l1, max, ancho), ajustar(l2 || l1, max, ancho))
  return [
    en(x, y, { text: l1 + (l2 ? '\n' + l2 : ''), width: ancho, fontSize: fs, bold: true, color: NEGRO, alignment: 'center', lineHeight: 1.02 }),
    en(x, y + fs * 2.42 + 0.5, { text: `Gestión ${ctx.gestion}`, width: ancho, fontSize: 5.6, bold: true, color: NEGRO, alignment: 'center' }),
  ]
}
// Recuadro de la foto: foto si la hay; si no, el escudo del colegio; si tampoco hay escudo, recuadro vacío
function imagenNodos(x, y, w, h, est, ctx) {
  if (est.fotoData) return [
    en(x - 2, y - 2, { svg: marcoSvg(w + 4, h + 4, ctx.color), width: w + 4, height: h + 4 }),
    en(x + 1, y + 1, { image: est.fotoData, width: w - 2, height: h - 2 }),
  ]
  if (ctx.logo) return [en(x, y, { image: 'logo', fit: [w, h] })]
  return [en(x + 1, y + 1, { svg: vacioSvg(w - 2, h - 2), width: w - 2, height: h - 2 })]
}
function nombreNodo(x, y, ancho, nombre, max, alineacion) {
  const [l1, l2] = filasNombre(nombre)
  const fs = Math.min(ajustar(l1, max, ancho), ajustar(l2 || l1, max, ancho))
  return { nodo: en(x, y, { text: l1 + (l2 ? '\n' + l2 : ''), width: ancho, fontSize: fs, bold: true, color: NEGRO, alignment: alineacion, lineHeight: 1.05 }),
           alto: fs * 1.05 * (l2 ? 2 : 1) * 1.17 }
}
// Usuario (correo) con ícono, negrita, centrado en una línea; la letra se achica sola si el correo es largo
function usuarioNodo(x, y, ancho, email, max, C) {
  const fs = ajustar(email, max, ancho - max * 1.3, 0.57, 5)
  const icono = fs * 1.05
  const textoW = anchoTexto(email, fs, 0.57)
  const izq = Math.max(0, (ancho - icono - 2 - textoW) / 2)
  return en(x, y, { columns: [
    { width: izq, text: '' },
    { width: icono, svg: iconoSvg(C), margin: [0, fs * 0.12, 0, 0] },
    { width: '*', text: email, fontSize: fs, bold: true, color: NEGRO, margin: [2, 0, 0, 0] },
  ] })
}
function pieNodo(x, y, w, h) {
  return en(x, y + h - 10.6, { text: 'CREDENCIAL ESCOLAR', width: w, fontSize: 5.5, bold: true, color: NEGRO, alignment: 'center', characterSpacing: 1.2 })
}

function tarjetaVertical(x, y, est, ctx) {
  const { w: W, h: H } = FORMATOS.vertical, C = ctx.color, alto = 42
  const o = [en(x, y, { svg: fondoSvg(W, H, alto, C), width: W, height: H })]
  o.push(...encabezado(x + 6, y + 6 + (CINTA ? 3 : 0), W - 12, ctx, 10))
  const iw = 46, ih = 46, iy = y + alto + 2
  o.push(...imagenNodos(x + (W - iw) / 2, iy, iw, ih, est, ctx))
  const n = nombreNodo(x + 6, iy + ih + 3, W - 12, est.nombre_completo, 7.6, 'center')
  o.push(n.nodo)
  const cy = iy + ih + 3 + n.alto + 1
  o.push(en(x + 6, cy, { text: (est.curso ?? ctx.curso).toUpperCase(), width: W - 12, fontSize: 6.2, bold: true, color: NEGRO, alignment: 'center', characterSpacing: 0.3 }))
  const libreY = cy + 9, libreH = (y + H - 14 - 12) - libreY          // espacio entre el curso y el usuario
  const q = ladoQR(est.codigo, Math.min(92, libreH))                // QR lo más grande posible, centrado
  const qy = libreY + (libreH - q) / 2
  o.push(en(x + (W - q) / 2, qy, { qr: est.codigo, fit: q, eccLevel: 'M' }))
  if (est.email) o.push(usuarioNodo(x + 5, y + H - 14 - 11.5, W - 10, est.email, 9, C))
  o.push(pieNodo(x, y, W, H))
  return o
}

function tarjetaHorizontal(x, y, est, ctx) {
  const { w: W, h: H } = FORMATOS.horizontal, C = ctx.color, alto = CINTA ? 39 : 36
  const o = [en(x, y, { svg: fondoSvg(W, H, alto, C), width: W, height: H })]
  o.push(...encabezado(x + 8, y + 5 + (CINTA ? 3 : 0), W - 16, ctx, CINTA ? 9.2 : 10))
  const pieY = y + H - 14, usuarioY = pieY - 12
  const cuerpoY = y + alto + 2, cuerpoH = usuarioY - cuerpoY
  const q = ladoQR(est.codigo, cuerpoH - 6)                       // QR lo más grande que entra con margen blanco, centrado
  const qy = cuerpoY + (cuerpoH - q) / 2
  o.push(en(x + W - q - 9, qy, { qr: est.codigo, fit: q, eccLevel: 'M' }))
  const iw = 42, ih = 42, ix = x + 9, iy = cuerpoY + (cuerpoH - ih) / 2
  o.push(...imagenNodos(ix, iy, iw, ih, est, ctx))
  const tx = ix + iw + 7, tw = (x + W - q - 9 - 5) - tx
  const n = nombreNodo(tx, 0, tw, est.nombre_completo, 8.2, 'left')
  const bloque = n.alto + 2 + 8
  const ty = cuerpoY + (cuerpoH - bloque) / 2
  o.push({ ...n.nodo, absolutePosition: { x: tx, y: ty } })
  o.push(en(tx, ty + n.alto + 2, { text: (est.curso ?? ctx.curso).toUpperCase(), width: tw, fontSize: ajustar((est.curso ?? ctx.curso).toUpperCase(), 6.6, tw), bold: true, color: NEGRO, characterSpacing: 0.3 }))
  if (est.email) o.push(usuarioNodo(x + 6, usuarioY, W - 12, est.email, 9, C))
  o.push(pieNodo(x, y, W, H))
  return o
}

const lineaCorte = (x, y, w, h) => en(x, y, { canvas: [{ type: 'rect', x: 0, y: 0, w, h, dash: { length: 2 }, lineWidth: 0.3, lineColor: '#9ca3af' }] })

/**
 * @param {object} p
 *   colegio: { nombre, logo_url, color_primario }, gestion, curso (texto),
 *   estudiantes: [{ nombre_completo, codigo, foto_url, email, curso? }], incluirFotos: bool,
 *   orientacion: 'vertical' (9 por hoja) | 'horizontal' (10 por hoja), archivo
 *   PDF continuo (varios cursos seguidos, sin hojas a medio llenar): cada estudiante trae su "curso" y
 *   etiquetaHojas = true imprime en el margen de cada hoja qué cursos lleva, para repartir después del corte
 */
export async function imprimirCredenciales({ colegio, gestion, curso, estudiantes, incluirFotos = true, orientacion = 'vertical',
  archivo = 'credenciales-qr.pdf', soloBuffer = false, logoData, etiquetaHojas = false }) {
  if (typeof pdfMake === 'undefined') throw new Error('No se cargó la librería de PDF')
  if (!estudiantes?.length) throw new Error('No hay estudiantes para imprimir')

  const f = FORMATOS[orientacion] ?? FORMATOS.vertical
  const dibujar = orientacion === 'horizontal' ? tarjetaHorizontal : tarjetaVertical
  const logo = logoData !== undefined ? logoData : await logoReducido(colegio?.logo_url)
  const fotos = incluirFotos ? await Promise.all(estudiantes.map(e => imagenDataUrl(e.foto_url))) : []
  const items = estudiantes.map((e, i) => ({
    ...e,
    nombre_completo: (e.nombre_completo ?? '').replace(/\s+/g, ' ').trim(),
    email: (e.email ?? '').trim(),
    fotoData: fotos[i] ?? null,
  }))
  const ctx = { logo, colegio: (colegio?.nombre ?? '').toUpperCase(), gestion, curso: curso ?? '', color: colorValido(colegio?.color_primario) }

  const porHoja = f.cols * f.filas
  const mx = (CARTA.w - f.cols * f.w) / 2, my = (CARTA.h - f.filas * f.h) / 2
  const paginas = []
  for (let i = 0; i < items.length; i += porHoja) {
    const nodos = [], hoja = items.slice(i, i + porHoja)
    if (etiquetaHojas) {   // ej.: "Hoja 12 · 6° Secundaria A (5) + 6° Secundaria B (4)"
      const cuenta = new Map()
      hoja.forEach(e => { const c = e.curso ?? ctx.curso; cuenta.set(c, (cuenta.get(c) ?? 0) + 1) })
      const texto = `Hoja ${paginas.length + 1} · ` + [...cuenta].map(([c, n]) => `${c} (${n})`).join(' + ')
      nodos.push(en(mx, Math.max(3, my - 9), { text: texto, width: CARTA.w - 2 * mx, fontSize: 6.5, bold: true, color: '#475569' }))
    }
    hoja.forEach((est, k) => {
      const x = mx + (k % f.cols) * f.w, y = my + Math.floor(k / f.cols) * f.h
      nodos.push(lineaCorte(x, y, f.w, f.h), ...dibujar(x, y, est, ctx))
    })
    paginas.push(paginas.length ? { stack: nodos, pageBreak: 'before' } : { stack: nodos })
  }

  const doc = {
    pageSize: 'LETTER',
    pageMargins: [0, 0, 0, 0],
    content: paginas,
    defaultStyle: { font: 'Roboto' },
    images: logo ? { logo } : {},          // el logo se incrusta UNA vez y lo reutilizan todas las tarjetas
  }
  const pdf = pdfMake.createPdf(doc)
  if (soloBuffer) return await new Promise((ok) => pdf.getBuffer(ok))   // para el .zip por nivel
  pdf.download(archivo)
}

/** Logo reducido a 240 px (en la tarjeta mide ~0,7 cm; el original puede pesar >1 MB) */
export async function logoReducido(url) {
  const data = await imagenDataUrl(url)
  if (!data) return null
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = data })
    const max = 240, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const c = document.createElement('canvas')
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k)
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
    return c.toDataURL('image/png')
  } catch { return data }
}
export { imagenDataUrl }