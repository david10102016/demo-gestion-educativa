// js/porteria/escaner.js
// Pantalla del REGENTE (dashboard-regente.html): solo registra ingresos y salidas.
//   · Modo ENTRADA / SALIDA elegido por el regente (queda fijo hasta cambiarlo)
//   · Cámara del celular (html5-qrcode) o lector 2D USB/Bluetooth (actúa como teclado)
//   · "Sin QR": búsqueda por nombre → registro manual
//   · Motivo opcional en atrasos y salidas anticipadas
//   · Sin internet: valida contra la lista guardada y encola (cola-offline.js)
//   · Encabezado DINÁMICO: escudo, nombre y color del colegio del regente (base de datos; sin internet, lo guardado)
//   · Reloj, contador del día en este celular, destello de pantalla completa con sonido al escanear
//   · Botón "atrás" del celular: cierra Fotos / Sin QR / cámara antes de salir (2 toques para salir)
import { verificarSesion, logout } from '../auth/auth.js'
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar, debounce } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import * as api from './porteria-api.js'
import * as cola from './cola-offline.js'
import { montarFotos } from './fotos.js'

const LS_MODO = 'porteria_modo'
const LS_DISP = 'porteria_dispositivo'
const LS_CAMARA = 'porteria_camara'
const ENFRIAR_MS = 5000          // ignora el mismo código durante 5 s (lectura repetida de la cámara)

let perfil = null
let modo = localStorage.getItem(LS_MODO) === 'salida' ? 'salida' : 'entrada'
let dispositivo = localStorage.getItem(LS_DISP) || ''
let lista = []                   // [{ estudiante_id, nombre_completo, curso, nivel, foto_url, codigo }]
let porCodigo = new Map()
let porId = new Map()
let ultimoCodigo = { codigo: null, t: 0 }
let ultimoRegistro = null        // { registroId | clientUuid, offline }
let escaner = null
let recientes = []

const $ = (id) => document.getElementById(id)
const enLinea = () => navigator.onLine

// ─── Inicio ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const sesion = await verificarSesion('regente')
  if (!sesion) return
  perfil = sesion.perfil
  $('esc-usuario').textContent = perfil.nombre_completo

  $('btn-salir').onclick = async () => {
    const n = await cola.contarPendientes()
    const msg = n ? `Hay ${n} registro(s) sin enviar. Se enviarán la próxima vez que abra el escáner con internet. ¿Salir igual?` : '¿Cerrar sesión?'
    if (await confirmar('Salir', msg, 'Salir', 'Cancelar')) logout()
  }

  pintarColegio(leerColegioGuardado())           // al instante: lo guardado de ESTE colegio
  iniciarReloj()
  if (enLinea()) {
    try {
      const { data: col } = await supabase.from('colegios').select('nombre, logo_url, color_primario').eq('id', perfil.colegio_id).single()
      if (col) { pintarColegio(col); guardarColegio(col) }
    } catch {}
    if (!(await api.porteriaActiva())) return bloquear('La Portería QR no está activada en este colegio. Pida al director que la active en Configuración.')
  }

  await cargarLista()
  pintarModo()
  pintarDispositivo()
  pintarRed()
  await pintarPendientes()
  conectarEventos()
  pintarContador()
  activarBotonAtras()
  if (!dispositivo) $('modal-dispositivo').classList.remove('hidden')
  enfocarLector()
  camaraAutomatica()
  sincronizar()
  setInterval(sincronizar, 30000)
})

function bloquear(msg) {
  $('esc-principal').style.display = 'none'
  $('esc-bloqueo').style.display = 'block'
  $('esc-bloqueo').innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔒</div><div class="empty-state-title">${escapeHtml(msg)}</div></div>`
}

// ─── Lista de estudiantes (servidor → celular) ──────────────
async function cargarLista() {
  if (enLinea()) {
    try {
      lista = await api.listaEscaner() ?? []
      await cola.guardarLista(perfil.colegio_id, lista)
    } catch (e) {
      const guardada = await cola.leerLista(perfil.colegio_id)
      lista = guardada?.items ?? []
      if (!lista.length) toast('No se pudo cargar la lista de estudiantes: ' + e.message, 'error', 6000)
    }
  } else {
    const guardada = await cola.leerLista(perfil.colegio_id)
    lista = guardada?.items ?? []
    if (!lista.length) return bloquear('Sin internet y sin lista guardada. Abra el escáner una vez con internet para descargar la lista.')
    toast('Sin internet: usando la lista guardada en este celular', 'warning', 5000)
  }
  porCodigo = new Map(lista.filter(x => x.codigo).map(x => [x.codigo, x]))
  porId = new Map(lista.map(x => [x.estudiante_id, x]))
}

// ─── Eventos ────────────────────────────────────────────────
function conectarEventos() {
  document.querySelectorAll('.modo').forEach(b => b.onclick = () => {
    modo = b.dataset.modo
    localStorage.setItem(LS_MODO, modo)
    pintarModo()
    enfocarLector()
  })

  // Lector 2D: escribe el código y presiona Enter
  $('input-lector').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const codigo = e.target.value.trim()
    e.target.value = ''
    if (codigo) procesar({ codigo })
  })
  document.addEventListener('click', (e) => {
    if (!e.target.closest('input, textarea, .modal-box, button')) enfocarLector()
  })

  $('btn-camara').onclick = alternarCamara
  $('btn-fotos').onclick = abrirFotos
  $('btn-sin-qr').onclick = abrirSinQr
  $('buscar-sin-qr').addEventListener('input', debounce(buscarSinQr, 200))
  $('btn-motivo').onclick = guardarMotivo
  $('btn-guardar-dispositivo').onclick = () => {
    const v = $('input-dispositivo').value.trim()
    if (!v) { toast('Escriba un nombre para este celular', 'warning'); return }
    dispositivo = v
    localStorage.setItem(LS_DISP, v)
    $('modal-dispositivo').classList.add('hidden')
    pintarDispositivo()
  }
  $('chip-dispositivo').onclick = () => {
    $('input-dispositivo').value = dispositivo
    $('modal-dispositivo').classList.remove('hidden')
  }

  window.addEventListener('online',  () => { pintarRed(); sincronizar(); cargarLista() })
  window.addEventListener('offline', pintarRed)
}

function enfocarLector() {
  const modalAbierto = !$('modal-sin-qr').classList.contains('hidden') || !$('modal-dispositivo').classList.contains('hidden')
  if (!modalAbierto && document.activeElement?.id !== 'motivo-texto') $('input-lector').focus({ preventScroll: true })
}

// ─── Modo Fotos (095) ───────────────────────────────────────
async function abrirFotos() {
  if (!enLinea()) { toast('Las fotos necesitan internet', 'warning'); return }
  if (escaner) await alternarCamara(false)       // apaga la cámara del escáner (sin olvidar que el regente la usa)
  $('esc-principal').style.display = 'none'
  $('btn-fotos').style.display = 'none'
  $('esc-fotos').style.display = 'block'
  await montarFotos($('esc-fotos'), { colegioId: perfil.colegio_id, esDirector: false, onVolver: cerrarFotos })
  const volver = document.createElement('button')
  volver.className = 'btn btn-primary volver-esc'
  volver.textContent = '← Volver al escáner'
  volver.onclick = cerrarFotos
  $('esc-fotos').prepend(volver)
  window.scrollTo({ top: 0 })
}
function cerrarFotos() {
  $('esc-fotos').style.display = 'none'
  $('esc-fotos').innerHTML = ''
  $('esc-principal').style.display = 'block'
  $('btn-fotos').style.display = ''
  enfocarLector()
}

// ─── Cámara ─────────────────────────────────────────────────
async function alternarCamara(porElRegente = true) {
  if (typeof Html5Qrcode === 'undefined') { toast('No se pudo cargar el lector de cámara. Revise la conexión y recargue.', 'error'); return }
  if (escaner) {
    await escaner.stop().catch(() => {})
    escaner = null
    $('btn-camara').textContent = '📷 Activar cámara'
    if (porElRegente === true) localStorage.setItem(LS_CAMARA, '0')   // la apagó él: no se enciende sola
    return
  }
  try {
    escaner = new Html5Qrcode('lector')
    await escaner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s } } },
      (texto) => procesar({ codigo: texto.trim() }),
      () => {}
    )
    $('btn-camara').textContent = '⏹ Detener cámara'
    localStorage.setItem(LS_CAMARA, '1')
  } catch (e) {
    escaner = null
    toast('No se pudo abrir la cámara. Permita el acceso a la cámara en el navegador.', 'error', 6000)
  }
}

// ─── Registro ───────────────────────────────────────────────
async function procesar({ codigo = null, estudianteId = null }) {
  const ahora = Date.now()
  const clave = codigo ?? estudianteId
  if (clave === ultimoCodigo.codigo && ahora - ultimoCodigo.t < ENFRIAR_MS) return   // lectura repetida
  ultimoCodigo = { codigo: clave, t: ahora }

  const local = codigo ? porCodigo.get(codigo) : porId.get(estudianteId)
  const clientUuid = api.nuevoUuid()
  const base = { clientUuid, tipo: modo, codigo, estudianteId: codigo ? null : estudianteId, dispositivo }

  if (enLinea()) {
    try {
      const r = await api.registrar({ ...base, hora: null })      // con internet: hora del servidor
      ultimoRegistro = { registroId: r.registro_id, offline: false }
      mostrarResultado({
        clase: r.duplicado ? 'aviso' : 'ok', tipo: r.tipo, nombre: r.nombre, curso: r.curso,
        foto: r.foto_url, hora: r.hora, estado: r.estado, duplicado: r.duplicado, manual: r.metodo === 'manual',
      })
      agregarReciente({ nombre: r.nombre, tipo: r.tipo, hora: r.hora, estado: r.estado, duplicado: !!r.duplicado, pendiente: false })
      if (!r.duplicado) sumarContador(r.tipo, r.estado)
      return
    } catch (e) {
      const msg = String(e?.message ?? e)
      const esRed = /fetch|network|Failed|timeout/i.test(msg)
      if (!esRed) { mostrarError(msg); return }
      // Falló la red en este instante: se guarda en la cola
    }
  }

  // ── Sin internet ──
  if (!local) { mostrarError(codigo ? 'QR no reconocido en la lista guardada' : 'Estudiante no encontrado'); return }
  const item = { ...base, hora: new Date().toISOString(), motivo: null, nombre: local.nombre_completo }
  await cola.encolar(item)
  ultimoRegistro = { clientUuid, offline: true }
  mostrarResultado({
    clase: 'ok', tipo: modo, nombre: local.nombre_completo, curso: local.curso, foto: local.foto_url,
    hora: item.hora, estado: null, pendiente: true, manual: !codigo,
  })
  agregarReciente({ nombre: local.nombre_completo, tipo: modo, hora: item.hora, estado: null, pendiente: true, clientUuid })
  sumarContador(modo, null)
  pintarPendientes()
}

function mostrarResultado({ clase, tipo, nombre, curso, foto, hora, estado, duplicado = false, pendiente = false, manual = false }) {
  const el = $('resultado')
  el.className = `resultado ${clase}`
  const tipoTxt = tipo === 'entrada' ? 'ENTRADA' : 'SALIDA'
  $('res-tipo').textContent = `✓ ${tipoTxt} · ${api.horaBolivia(hora)}`
  $('res-tipo').style.color = tipo === 'entrada' ? '#16a34a' : '#2563eb'
  $('res-nombre').textContent = nombre ?? '—'
  $('res-meta').textContent = [curso, manual ? 'Manual – sin QR' : null].filter(Boolean).join(' · ')
  pintarFoto($('res-foto'), foto, nombre)

  const est = $('res-estado')
  if (pendiente) {
    est.textContent = 'Guardado en el celular · se enviará al volver internet'
    est.style.background = '#fef9c3'; est.style.color = '#854d0e'
  } else if (duplicado) {
    est.textContent = 'Ya estaba registrado hace instantes (duplicado)'
    est.style.background = '#fef9c3'; est.style.color = '#854d0e'
  } else {
    const e = api.ESTADOS[estado] ?? api.ESTADOS.a_tiempo
    est.textContent = `${e.icono} ${e.texto}`
    est.style.background = e.fondo; est.style.color = e.color
  }

  // Motivo: solo en atraso o salida anticipada (o sin internet, donde aún no se sabe el estado)
  const pideMotivo = !duplicado && (pendiente || estado === 'atraso' || estado === 'salida_anticipada')
  $('motivo').style.display = pideMotivo ? 'flex' : 'none'
  $('motivo-texto').value = ''
  if (navigator.vibrate) navigator.vibrate(duplicado ? [80, 60, 80] : 120)
  mostrarFlash({ tipo, nombre, curso, foto, hora, estado, duplicado, pendiente, manual })
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })   // en celular la tarjeta queda debajo de la cámara
}

// Tarjeta en pantalla de un registro hecho sin internet, una vez que el servidor lo confirmó
function actualizarTarjeta(r) {
  const est = $('res-estado')
  if (r.duplicado) {
    est.textContent = 'Ya estaba registrado hace instantes (duplicado)'
    est.style.background = '#fef9c3'; est.style.color = '#854d0e'
    $('resultado').className = 'resultado aviso'
    $('motivo').style.display = 'none'
    return
  }
  const e = api.ESTADOS[r.estado] ?? api.ESTADOS.a_tiempo
  est.textContent = `${e.icono} ${e.texto}`
  est.style.background = e.fondo; est.style.color = e.color
  const pideMotivo = r.estado === 'atraso' || r.estado === 'salida_anticipada'
  if (!pideMotivo) $('motivo').style.display = 'none'
}

function mostrarError(msg) {
  const el = $('resultado')
  el.className = 'resultado error'
  $('res-tipo').textContent = '✕ No registrado'
  $('res-tipo').style.color = '#b91c1c'
  $('res-nombre').textContent = msg
  $('res-meta').textContent = ''
  $('res-estado').textContent = ''
  $('res-estado').style.background = 'transparent'
  $('res-foto').textContent = '!'
  $('motivo').style.display = 'none'
  if (navigator.vibrate) navigator.vibrate([200, 80, 200])
  mostrarFlash({ error: msg })
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function guardarMotivo() {
  const texto = $('motivo-texto').value.trim()
  if (!texto || !ultimoRegistro) { toast('Escriba el motivo', 'warning'); return }
  try {
    if (ultimoRegistro.offline) await cola.actualizarMotivo(ultimoRegistro.clientUuid, texto)
    else await api.anotarMotivo(ultimoRegistro.registroId, texto)
    $('motivo').style.display = 'none'
    toast('Motivo guardado', 'success')
  } catch (e) {
    toast(e.message, 'error')
  }
  enfocarLector()
}

// ─── Sin QR ─────────────────────────────────────────────────
function abrirSinQr() {
  if (!lista.length) { toast('No hay lista de estudiantes cargada', 'warning'); return }
  $('modal-sin-qr').classList.remove('hidden')
  $('buscar-sin-qr').value = ''
  $('resultados-sin-qr').innerHTML = '<div class="text-sm text-muted" style="padding:8px;">Escriba al menos 3 letras.</div>'
  setTimeout(() => $('buscar-sin-qr').focus(), 50)
}

function normalizar(s) { return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

function buscarSinQr() {
  const q = normalizar($('buscar-sin-qr').value.trim())
  const cont = $('resultados-sin-qr')
  if (q.length < 3) { cont.innerHTML = '<div class="text-sm text-muted" style="padding:8px;">Escriba al menos 3 letras.</div>'; return }
  const partes = q.split(/\s+/)
  const hallados = lista.filter(x => { const n = normalizar(x.nombre_completo); return partes.every(p => n.includes(p)) }).slice(0, 30)
  if (!hallados.length) { cont.innerHTML = '<div class="text-sm text-muted" style="padding:8px;">Sin coincidencias.</div>'; return }
  cont.innerHTML = hallados.map(x => `
    <div class="buscador-item" data-id="${escapeHtml(x.estudiante_id)}">
      ${fotoHtml(x.foto_url, x.nombre_completo, 'mini-foto')}
      <div><div style="font-weight:600;">${escapeHtml(x.nombre_completo)}</div>
      <div class="text-sm text-muted">${escapeHtml(x.curso ?? '')}</div></div>
    </div>`).join('')
  cont.querySelectorAll('.buscador-item').forEach(el => el.onclick = () => {
    $('modal-sin-qr').classList.add('hidden')
    procesar({ estudianteId: el.dataset.id })
  })
}

// ─── Sincronización de la cola ──────────────────────────────
async function sincronizar() {
  if (!enLinea()) return
  const n = await cola.contarPendientes()
  if (!n) return
  const { enviados, rechazados } = await cola.enviarPendientes(async (it) => {
    const r = await api.registrar({
      clientUuid: it.clientUuid, tipo: it.tipo, codigo: it.codigo, estudianteId: it.estudianteId,
      hora: it.hora, dispositivo: it.dispositivo, motivo: it.motivo,
    })
    // La lista muestra el estado real que calculó el servidor
    recientes = recientes.map(x => x.clientUuid === it.clientUuid ? { ...x, estado: r?.estado ?? null, duplicado: !!r?.duplicado, pendiente: false } : x)
    // Si es el registro que está en pantalla: la tarjeta pasa de "Guardado en el celular" al estado real
    if (ultimoRegistro?.offline && ultimoRegistro.clientUuid === it.clientUuid && r?.registro_id) {
      ultimoRegistro = { registroId: r.registro_id, offline: false }      // el motivo ahora se guarda en el servidor
      actualizarTarjeta(r)
    }
    return r
  })
  if (enviados) toast(`${enviados} registro(s) sin internet enviados`, 'success', 5000)
  rechazados.forEach(r => toast(`No se pudo enviar: ${r.item.nombre ?? ''} (${r.motivo})`, 'error', 8000))
  const rechazadosIds = new Set(rechazados.map(r => r.item.clientUuid))
  recientes = recientes.map(x => rechazadosIds.has(x.clientUuid) ? { ...x, pendiente: false, rechazado: true } : x)
  pintarRecientes()
  pintarPendientes()
}

// ─── Pintado ────────────────────────────────────────────────
function pintarModo() {
  document.querySelectorAll('.modo').forEach(b => b.classList.toggle('activo', b.dataset.modo === modo))
  const av = $('modo-aviso')
  if (av) {
    av.textContent = modo === 'entrada' ? '⬇ Está registrando ENTRADAS' : '⬆ Está registrando SALIDAS'
    av.style.color = modo === 'entrada' ? '#16a34a' : '#2563eb'
  }
}
function pintarDispositivo() { $('chip-dispositivo').textContent = dispositivo ? `📱 ${dispositivo}` : '📱 Sin nombre' }
function pintarRed() {
  const on = enLinea()
  $('chip-red').className = `chip ${on ? 'chip-on' : 'chip-off'}`
  $('chip-red').textContent = on ? '● En línea' : '● Sin internet'
}
async function pintarPendientes() {
  const n = await cola.contarPendientes()
  $('chip-pend').style.display = n ? 'inline-block' : 'none'
  $('chip-pend').textContent = `${n} pendiente${n === 1 ? '' : 's'} de enviar`
}
function agregarReciente(r) {
  recientes.unshift(r)
  recientes = recientes.slice(0, 15)
  pintarRecientes()
}
function pintarRecientes() {
  if (!recientes.length) return
  $('lista-recientes').innerHTML = recientes.map(r => {
    const e = api.ESTADOS[r.estado]
    const borde = r.rechazado ? '#ef4444' : r.pendiente ? '#94a3b8' : r.duplicado ? '#f59e0b' : (e ? e.color : '#16a34a')
    return `<div class="reciente" style="border-left-color:${borde};">
      <span style="display:flex;align-items:center;gap:8px;min-width:0;"><span class="rec-ini">${escapeHtml(iniciales(r.nombre))}</span>
      <span style="min-width:0;"><strong>${r.tipo === 'entrada' ? '⬇ Entrada' : '⬆ Salida'}</strong> · ${escapeHtml(r.nombre ?? '')}</span></span>
      <span>${api.horaBolivia(r.hora)} ${r.pendiente ? '⏳' : r.rechazado ? '✕' : r.duplicado ? '<span title="Duplicado: ya estaba registrado">⧉</span>' : (e ? e.icono : '')}</span>
    </div>`
  }).join('')
}

function iniciales(n) { return (n ?? '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() }
function fotoHtml(_path, nombre, clase) {
  return `<div class="${clase}">${escapeHtml(iniciales(nombre))}</div>`
}
function pintarFoto(el, path, nombre) {
  el.textContent = iniciales(nombre)
  if (!path || !enLinea()) return
  api.urlFirmada(path).then(url => {
    if (url && $('res-nombre').textContent === nombre)
      el.innerHTML = `<img src="${escapeHtml(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">`
  }).catch(() => {})
}

// ─── Encabezado dinámico del colegio ────────────────────────
// Solo usa datos del colegio del regente que inició sesión (nunca de otro colegio guardado en el celular)
const claveColegio = () => `porteria_colegio_${perfil?.colegio_id}`
function leerColegioGuardado() {
  try {
    const propio = JSON.parse(localStorage.getItem(claveColegio()) || 'null')
    if (propio) return propio
  } catch {}
  // Lo que dejó el login, solo si es este mismo colegio
  if (localStorage.getItem('colegio_id') === perfil?.colegio_id) {
    return { nombre: localStorage.getItem('colegio_nombre'), logo_url: localStorage.getItem('colegio_logo_url'), color_primario: localStorage.getItem('color_primario') }
  }
  return null
}
function guardarColegio(col) {
  try { localStorage.setItem(claveColegio(), JSON.stringify({ nombre: col.nombre, logo_url: col.logo_url ?? '', color_primario: col.color_primario ?? '' })) } catch {}
}
function pintarColegio(col) {
  if (!col) return
  if (col.nombre) $('esc-colegio').textContent = col.nombre
  const color = /^#[0-9a-f]{6}$/i.test(col.color_primario ?? '') ? col.color_primario : null
  if (color) {
    document.documentElement.style.setProperty('--color-primary', color)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
  }
  const esc = $('esc-escudo')
  const sigla = (col.nombre ?? '').split(/\s+/).filter(w => w.length > 2).map(w => w[0]).join('').slice(-3).toUpperCase() || '🏫'
  if (col.logo_url) {
    const img = new Image()
    img.alt = ''
    img.onload = () => { esc.innerHTML = ''; esc.appendChild(img) }
    img.onerror = () => { esc.textContent = sigla }
    img.src = col.logo_url
  } else {
    esc.textContent = sigla
  }
}

// ─── Reloj (hora de Bolivia) ────────────────────────────────
function iniciarReloj() {
  const pintar = () => {
    $('esc-hora').textContent = api.horaBolivia(new Date().toISOString())
    const f = api.fechaLarga(api.hoyBolivia(), { weekday: 'long', day: 'numeric', month: 'long' })
    $('esc-fecha').textContent = f.charAt(0).toUpperCase() + f.slice(1)
  }
  pintar()
  setInterval(pintar, 15000)
}

// ─── Contador del día (en este celular) ─────────────────────
const claveContador = () => `porteria_cont_${perfil?.colegio_id}_${api.hoyBolivia()}`
function leerContador() {
  try { return JSON.parse(localStorage.getItem(claveContador()) || 'null') ?? { ent: 0, sal: 0, atr: 0 } } catch { return { ent: 0, sal: 0, atr: 0 } }
}
function sumarContador(tipo, estado) {
  const c = leerContador()
  if (tipo === 'entrada') c.ent++; else c.sal++
  if (estado === 'atraso') c.atr++
  try { localStorage.setItem(claveContador(), JSON.stringify(c)) } catch {}
  pintarContador()
}
function pintarContador() {
  const c = leerContador()
  $('cnt-ent').textContent = c.ent
  $('cnt-sal').textContent = c.sal
  $('cnt-atr').textContent = c.atr
}

// ─── Destello de pantalla completa + sonido ─────────────────
let flashTimer = null
function mostrarFlash({ error = null, tipo, nombre, curso, foto, hora, estado, duplicado = false, pendiente = false, manual = false }) {
  const f = $('flash')
  if (!f) return
  let fondo, estadoTxt, sonido
  if (error) { fondo = '#dc2626'; sonido = 'error' }
  else if (duplicado) { fondo = '#ca8a04'; estadoTxt = 'Ya estaba registrado (duplicado)'; sonido = 'aviso' }
  else if (pendiente) { fondo = '#475569'; estadoTxt = '⏳ Guardado en el celular · se enviará con internet'; sonido = 'ok' }
  else {
    const e = api.ESTADOS[estado] ?? api.ESTADOS.a_tiempo
    fondo = { a_tiempo: '#16a34a', normal: '#16a34a', atraso: '#ea580c', salida_anticipada: '#b45309', fuera_de_horario: '#4338ca' }[estado] ?? '#16a34a'
    estadoTxt = `${e.icono} ${e.texto}`
    sonido = (estado === 'atraso' || estado === 'salida_anticipada') ? 'aviso' : 'ok'
  }
  f.style.background = fondo
  f.innerHTML = error
    ? `<div class="f-foto">✕</div><div class="f-tipo">NO REGISTRADO</div><div class="f-nombre">${escapeHtml(error)}</div><div class="f-toque">Toque para cerrar</div>`
    : `<div class="f-foto" id="f-foto">${escapeHtml(iniciales(nombre))}</div>
       <div class="f-tipo">${tipo === 'entrada' ? '⬇ ENTRADA' : '⬆ SALIDA'} · ${escapeHtml(api.horaBolivia(hora))}</div>
       <div class="f-nombre">${escapeHtml(nombre ?? '—')}</div>
       <div class="f-meta">${escapeHtml([curso, manual ? 'Manual – sin QR' : null].filter(Boolean).join(' · '))}</div>
       <div class="f-estado">${escapeHtml(estadoTxt)}</div>
       <div class="f-toque">Toque para cerrar</div>`
  if (!error && foto && enLinea()) {
    api.urlFirmada(foto).then(url => {
      const el = document.getElementById('f-foto')
      if (url && el && f.classList.contains('on')) el.innerHTML = `<img src="${escapeHtml(url)}" alt="">`
    }).catch(() => {})
  }
  f.classList.remove('on'); void f.offsetWidth; f.classList.add('on')
  f.onclick = ocultarFlash
  sonar(sonido)
  clearTimeout(flashTimer)
  flashTimer = setTimeout(ocultarFlash, error ? 2600 : 2000)
}
function ocultarFlash() {
  clearTimeout(flashTimer)
  $('flash')?.classList.remove('on')
  enfocarLector()
}
let audioCtx = null
function sonar(tipo) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)()
    const notas = tipo === 'error' ? [[220, 0, .18], [180, .22, .22]] : tipo === 'aviso' ? [[660, 0, .12], [520, .15, .14]] : [[880, 0, .1], [1320, .1, .12]]
    notas.forEach(([fr, ini, dur]) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain()
      o.frequency.value = fr; o.type = 'sine'
      g.gain.setValueAtTime(.0001, audioCtx.currentTime + ini)
      g.gain.exponentialRampToValueAtTime(.25, audioCtx.currentTime + ini + .02)
      g.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + ini + dur)
      o.connect(g).connect(audioCtx.destination)
      o.start(audioCtx.currentTime + ini); o.stop(audioCtx.currentTime + ini + dur + .02)
    })
  } catch {}
}

// ─── Botón "atrás" del celular ──────────────────────────────
// Antes cerraba la aplicación. Ahora: cierra lo que esté abierto; en la pantalla principal pide 2 toques para salir.
function activarBotonAtras() {
  history.pushState({ porteria: true }, '')
  let ultimoAtras = 0
  window.addEventListener('popstate', async () => {
    const rearmar = () => history.pushState({ porteria: true }, '')
    if ($('flash')?.classList.contains('on')) { ocultarFlash(); return rearmar() }
    if ($('esc-fotos').style.display === 'block') {
      const fm = document.getElementById('fo-modal')
      if (fm && !fm.classList.contains('hidden')) fm.classList.add('hidden')
      else cerrarFotos()
      return rearmar()
    }
    if (!$('modal-sin-qr').classList.contains('hidden')) { $('modal-sin-qr').classList.add('hidden'); enfocarLector(); return rearmar() }
    if (!$('modal-dispositivo').classList.contains('hidden') && dispositivo) { $('modal-dispositivo').classList.add('hidden'); return rearmar() }
    if (document.getElementById('btn-ok')) { return rearmar() }   // ventana de confirmación abierta: se responde con sus botones
    if (escaner) { await alternarCamara(); toast('Cámara apagada', 'info', 1500); return rearmar() }
    const ahora = Date.now()
    if (ahora - ultimoAtras < 2000) { history.back(); return }       // segundo toque: sale
    ultimoAtras = ahora
    toast('Toque otra vez "atrás" para salir del escáner', 'info', 2000)
    rearmar()
  })
}

// ─── Cámara automática ──────────────────────────────────────
// Si el regente ya usó la cámara en este celular (y el permiso está dado), se enciende sola al entrar.
async function camaraAutomatica() {
  if (localStorage.getItem(LS_CAMARA) !== '1' || escaner) return
  try {
    const p = await navigator.permissions?.query({ name: 'camera' })
    if (p && p.state !== 'granted') return
  } catch { return }
  alternarCamara(false)
}
