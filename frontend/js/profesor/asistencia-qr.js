// js/profesor/asistencia-qr.js
// Llamar lista por QR (profesor). Alternativa al método manual, que NO cambia.
//   · La hora de inicio la fija el SERVIDOR (hora de Bolivia) en el PRIMER escaneo.
//   · 7 minutos de tolerancia desde ese inicio: dentro = Presente; después = Retraso
//     con los minutos contados desde el inicio (ej. inicio 14:10, llega 14:25 → 15 min).
//   · "Terminar": muestra quiénes no escanearon para confirmar mirando el aula
//     (el que está y no escaneó se marca Presente, manual); el resto queda Falta.
//   · Solo para HOY. Guarda en la misma lista (asistencias_materia): no se duplica.
// Backend: migración 100 (abrir_llamada_qr, registrar_asistencia_qr, cerrar_llamada_qr).
// Cámara: html5-qrcode (misma librería del regente; no toca escaner.js).
import { supabase } from '../config/supabase-config.js'
import { toast, confirmar } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { guardarAsistenciaMateria } from '../utils/asistencia-materia.js'

const ENFRIAR_MS = 4000           // ignora el mismo código 4 s (lectura repetida de la cámara)
const ZONA = 'America/La_Paz'

const hora = (ms, seg = false) => new Date(ms).toLocaleTimeString('es-BO', {
  hour: '2-digit', minute: '2-digit', ...(seg ? { second: '2-digit' } : {}), hour12: false, timeZone: ZONA,
})
const MOTIVOS = {
  otro_curso: 'no es de este curso',
  no_inscrito: 'no está inscrito en esta materia',
  sin_asignacion: 'es de un curso donde no tiene asignada esta materia',
}

/**
 * Abre la llamada de lista por QR.
 * @param {object} p
 * @param {string} p.cursoId     curso elegido en pantalla
 * @param {string} p.materiaId
 * @param {'regular'|'tecnica'} p.sesion
 * @param {string} p.fecha       'YYYY-MM-DD' (debe ser hoy)
 * @param {string} p.profesorId
 * @param {Array<{id, nombre, curso_id}>} p.estudiantes  lista visible en pantalla
 * @param {Function} p.alTerminar  se llama al cerrar (para recargar la lista)
 */
export async function abrirLlamadaQr({ cursoId, materiaId, sesion, fecha, profesorId, estudiantes, alTerminar }) {
  if (typeof Html5Qrcode === 'undefined') {
    toast('No se pudo cargar el lector de cámara. Revise la conexión y recargue la página.', 'error', 6000)
    return
  }

  // 1) Abrir la llamada en el servidor (todavía no corre el tiempo)
  let llamada
  try {
    const { data, error } = await supabase.rpc('abrir_llamada_qr', { p_curso_id: cursoId, p_materia_id: materiaId, p_sesion: sesion })
    if (error) throw error
    llamada = data
  } catch (e) {
    toast(e.message ?? 'No se pudo iniciar la llamada por QR', 'error', 6000)
    return
  }
  if (llamada.fecha !== fecha) {
    toast('La fecha de la lista no es la de hoy en Bolivia. Recargue la página.', 'error', 6000)
    return
  }

  const desfase = new Date(llamada.ahora).getTime() - Date.now()   // reloj del servidor vs. celular
  const ahoraServidor = () => Date.now() + desfase
  const tolMs = (llamada.tolerancia_min ?? 7) * 60000
  const porId = new Map(estudiantes.map(e => [e.id, e]))
  const escaneados = new Map()        // estudiante_id → { estado, hora, minutos }
  let finTolerancia = null            // ms (servidor), se fija con el primer escaneo
  let ultimo = { codigo: null, t: 0 }
  let ocupado = false
  let lector = null
  let reloj = null

  // 2) Ventana
  const ov = document.createElement('div')
  ov.className = 'modal-overlay'
  ov.style.zIndex = '9000'
  ov.innerHTML = `
    <div style="background:#0f172a;color:#fff;border-radius:16px;padding:16px;width:min(460px,96vw);max-height:96vh;overflow:auto;">
      <div id="qr-reloj" style="display:flex;justify-content:space-between;align-items:center;background:#334155;border-radius:10px;padding:10px 14px;">
        <div><div style="font-size:12px;opacity:.8;">Inicio (hora Bolivia)</div><b id="qr-inicio" style="font-size:18px;">— : —</b></div>
        <div style="text-align:right;"><div style="font-size:12px;opacity:.8;">Ahora</div><b id="qr-ahora" style="font-size:22px;">--:--:--</b></div>
      </div>
      <div id="qr-estado" style="font-size:13px;margin-top:6px;color:#cbd5e1;">⏳ Esperando el primer escaneo. El tiempo empieza a contar con el primer QR.</div>
      <div id="qr-lector" style="margin:12px auto;width:min(100%,42vh);border-radius:12px;overflow:hidden;background:#1e293b;"></div>
      <div id="qr-ultimos"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;">
        <span>Escaneados <b id="qr-cuenta">0</b> de ${estudiantes.length}</span>
        <button type="button" id="qr-terminar" class="btn" style="background:#dc2626;color:#fff;">Terminar</button>
      </div>
    </div>`
  document.body.appendChild(ov)
  const $ = (id) => ov.querySelector('#' + id)

  const pintarReloj = () => {
    if (!$('qr-ahora')) return            // pantalla de confirmación: no hay reloj
    const ahora = ahoraServidor()
    $('qr-ahora').textContent = hora(ahora, true)
    if (finTolerancia === null) return
    const dentro = ahora <= finTolerancia
    $('qr-reloj').style.background = dentro ? '#065f46' : '#9a3412'
    $('qr-estado').style.color = dentro ? '#86efac' : '#fdba74'
    $('qr-estado').textContent = dentro
      ? `✅ Dentro de la tolerancia · Presente hasta las ${hora(finTolerancia)}`
      : `🕒 Desde las ${hora(finTolerancia)} se marca Retraso`
  }
  reloj = setInterval(pintarReloj, 1000)
  pintarReloj()

  const pintarUltimo = (html, color) => {
    const cont = $('qr-ultimos')
    const item = document.createElement('div')
    item.style.cssText = `background:#1e293b;border-left:4px solid ${color};border-radius:10px;padding:9px 12px;margin-bottom:6px;font-size:14px;`
    item.innerHTML = html
    cont.prepend(item)
    while (cont.children.length > 4) cont.lastChild.remove()
    ;[...cont.children].forEach((c, i) => { c.style.opacity = i === 0 ? '1' : '.6' })
  }

  // 3) Escaneo
  async function procesar(codigo) {
    const t = Date.now()
    if (ocupado || (codigo === ultimo.codigo && t - ultimo.t < ENFRIAR_MS)) return
    ultimo = { codigo, t }
    ocupado = true
    try {
      const { data: r, error } = await supabase.rpc('registrar_asistencia_qr', { p_llamada_id: llamada.llamada_id, p_codigo: codigo })
      if (error) throw error
      if (!r.ok) {
        pintarUltimo(`⛔ <b>${escapeHtml(r.nombre ?? '')}</b> ${escapeHtml(MOTIVOS[r.motivo] ?? 'no pertenece a esta lista')}${r.curso ? ` <span style="opacity:.7">(${escapeHtml(r.curso)})</span>` : ''}`, '#ef4444')
        navigator.vibrate?.([80, 60, 80])
        return
      }
      if (finTolerancia === null && r.inicio) {
        // El servidor fijó el inicio con este primer escaneo
        finTolerancia = ahoraServidor() + tolMs
        $('qr-inicio').textContent = r.inicio
        pintarReloj()
      }
      if (r.repetido) {
        pintarUltimo(`🔁 <b>${escapeHtml(r.nombre)}</b> ya estaba registrado · ${r.estado === 'retraso' ? 'Retraso' : 'Presente'} ${escapeHtml(r.hora)}`, '#64748b')
        return
      }
      escaneados.set(r.estudiante_id, { estado: r.estado, hora: r.hora, minutos: r.minutos })
      $('qr-cuenta').textContent = String(escaneados.size)
      if (r.estado === 'retraso') {
        pintarUltimo(`🕒 <b>${escapeHtml(r.nombre)}</b> · Retraso ${escapeHtml(r.hora)} <span style="color:#fdba74">(${r.minutos} min tarde)</span>`, '#f97316')
      } else {
        pintarUltimo(`✅ <b>${escapeHtml(r.nombre)}</b> · Presente ${escapeHtml(r.hora)}`, '#22c55e')
      }
      if (!porId.has(r.estudiante_id)) porId.set(r.estudiante_id, { id: r.estudiante_id, nombre: r.nombre })
      navigator.vibrate?.(60)
    } catch (e) {
      pintarUltimo(`⚠️ ${escapeHtml(e.message ?? 'No se pudo registrar')}`, '#eab308')
    } finally {
      ocupado = false
    }
  }

  async function encenderCamara() {
    try {
      lector = new Html5Qrcode('qr-lector')
      await lector.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: (w, h) => { const s = Math.floor(Math.min(w, h) * 0.7); return { width: s, height: s } } },
        (texto) => procesar(texto.trim()),
        () => {}
      )
    } catch {
      lector = null
      toast('No se pudo abrir la cámara. Permita el acceso a la cámara en el navegador.', 'error', 6000)
    }
  }
  const apagarCamara = async () => { if (lector) { await lector.stop().catch(() => {}); lector = null } }

  const cerrarTodo = () => { clearInterval(reloj); ov.remove() }

  // 4) Terminar → confirmar ausentes
  $('qr-terminar').onclick = async () => {
    await apagarCamara()
    if (!escaneados.size) {
      if (await confirmar('Terminar', 'No se escaneó a ningún estudiante. ¿Cancelar la llamada por QR? La lista queda como estaba.', 'Cancelar llamada', 'Seguir escaneando')) {
        await supabase.rpc('cerrar_llamada_qr', { p_llamada_id: llamada.llamada_id })
        cerrarTodo()
      } else {
        encenderCamara()
      }
      return
    }
    mostrarConfirmacion()
  }

  function mostrarConfirmacion() {
    clearInterval(reloj)
    const faltan = estudiantes.filter(e => !escaneados.has(e.id))
    const caja = ov.firstElementChild
    caja.style.background = '#fff'
    caja.style.color = '#0f172a'
    caja.innerHTML = `
      <div style="font-weight:700;font-size:16px;">No escanearon (${faltan.length}) — mira el aula y confirma</div>
      <p style="font-size:13px;color:#475569;margin:6px 0 10px;">Si alguien está en el aula y no escaneó (olvidó su credencial), márcalo <b>Está en el aula</b>. Los demás quedarán como <b>Falta</b>.</p>
      <div id="qr-faltan" style="max-height:50vh;overflow:auto;">
        ${faltan.length ? faltan.map(e => `
          <label style="display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-top:1px solid #e2e8f0;font-size:14px;cursor:pointer;gap:10px;">
            <span>${escapeHtml(e.nombre)}</span>
            <span style="display:flex;align-items:center;gap:6px;font-size:12px;white-space:nowrap;">
              <input type="checkbox" data-id="${escapeHtml(e.id)}" style="width:auto;"> Está en el aula
            </span>
          </label>`).join('') : '<div style="padding:10px 0;color:#166534;">✅ Todos escanearon.</div>'}
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;flex-wrap:wrap;">
        <button type="button" id="qr-volver" class="btn btn-secondary">Volver a escanear</button>
        <button type="button" id="qr-guardar" class="btn btn-primary">Confirmar y guardar</button>
      </div>`

    caja.querySelector('#qr-volver').onclick = () => abrirContinuacion()   // misma llamada, mismo inicio

    caja.querySelector('#qr-guardar').onclick = async () => {
      const enAula = new Set([...caja.querySelectorAll('input[type=checkbox]:checked')].map(c => c.dataset.id))
      const payload = faltan.map(e => ({
        estudiante_id: e.id,
        curso_id: e.curso_id || cursoId,
        materia_id: materiaId,
        profesor_id: profesorId,
        fecha,
        sesion,
        estado: enAula.has(e.id) ? 'presente' : 'falta',
        // Presente confirmado a la vista = marca manual (sin hora). Falta = parte de la llamada QR.
        metodo: enAula.has(e.id) ? 'manual' : 'qr',
        llamada_id: llamada.llamada_id,
      }))
      if (payload.length) {
        const r = await guardarAsistenciaMateria(payload)
        if (!r.ok) return
      }
      await supabase.rpc('cerrar_llamada_qr', { p_llamada_id: llamada.llamada_id })
      cerrarTodo()
      toast(`Lista por QR cerrada · ${escaneados.size} escaneados, ${payload.filter(p => p.estado === 'falta').length} faltas`, 'success', 5000)
      alTerminar?.()
    }
  }

  // "Volver a escanear": misma llamada, mismo inicio y mismos escaneados
  function abrirContinuacion() {
    clearInterval(reloj)
    ov.innerHTML = `
      <div style="background:#0f172a;color:#fff;border-radius:16px;padding:16px;width:min(460px,96vw);max-height:96vh;overflow:auto;">
        <div id="qr-reloj" style="display:flex;justify-content:space-between;align-items:center;background:#334155;border-radius:10px;padding:10px 14px;">
          <div><div style="font-size:12px;opacity:.8;">Inicio (hora Bolivia)</div><b id="qr-inicio" style="font-size:18px;">${finTolerancia ? hora(finTolerancia - tolMs) : '— : —'}</b></div>
          <div style="text-align:right;"><div style="font-size:12px;opacity:.8;">Ahora</div><b id="qr-ahora" style="font-size:22px;">--:--:--</b></div>
        </div>
        <div id="qr-estado" style="font-size:13px;margin-top:6px;color:#cbd5e1;"></div>
        <div id="qr-lector" style="margin:12px auto;width:min(100%,42vh);border-radius:12px;overflow:hidden;background:#1e293b;"></div>
        <div id="qr-ultimos"></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:8px;">
          <span>Escaneados <b id="qr-cuenta">${escaneados.size}</b> de ${estudiantes.length}</span>
          <button type="button" id="qr-terminar" class="btn" style="background:#dc2626;color:#fff;">Terminar</button>
        </div>
      </div>`
    $('qr-terminar').onclick = async () => { await apagarCamara(); mostrarConfirmacion() }
    reloj = setInterval(pintarReloj, 1000)
    pintarReloj()
    encenderCamara()
  }

  encenderCamara()
}