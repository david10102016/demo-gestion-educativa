// js/porteria/calendario-ingreso.js
// Vista "Ingreso al colegio" para ESTUDIANTE y TUTOR (la misma pieza para los dos).
//   · Tutor con varios hijos: tarjeta "Hoy" de todos + chips para elegir uno
//   · Semana (por defecto, ‹ ›) y Mes (calendario, un color por día); tocar un día muestra el detalle
// Uso: montarIngreso(contenedor, [{ id, nombre, curso }])
import * as api from './porteria-api.js'
import { supabase } from '../config/supabase-config.js'
import { fetchConCache } from '../utils/data-layer.js'
import { insertarAvisoCopia } from '../utils/connection-status.js'

// Consulta con copia guardada por usuario: sin conexión devuelve lo último descargado.
async function conCopia(key, usuarioId, fn) {
  const res = await fetchConCache({
    key, colegioId: null, usuarioId, ms: 15000,
    run: async () => {
      try { return { data: await fn(), error: null } }
      catch (e) { return { data: null, error: e } }
    },
  })
  if (res.error) throw res.error
  return res
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
// "APELLIDO APELLIDO NOMBRES" → nombres (los hermanos comparten apellido)
const nombreCorto = (n) => { const p = String(n ?? '').trim().split(/\s+/); return p.length > 2 ? p.slice(2).join(' ') : p.join(' ') }
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

export async function montarIngreso(cont, estudiantes) {
  if (!cont) return
  if (!estudiantes?.length) { cont.innerHTML = '<div class="empty-state"><div class="empty-state-title">Sin estudiantes vinculados</div></div>'; return }

  const hoy = api.hoyBolivia()
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id ?? null
  const avisoCopia = (res) => { if (res?.offline) insertarAvisoCopia(cont, res.syncedAt) }
  const _inicio = new Map()   // primer día con portería de cada estudiante
  const st = { sel: estudiantes[0].id, vista: 'semana', ancla: hoy }

  cont.innerHTML = `
    <div id="ing-hoy"></div>
    ${estudiantes.length > 1 ? `<div id="ing-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;"></div>` : ''}
    <div class="card" style="margin-top:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;">
        <div style="display:flex;gap:4px;">
          <button class="btn btn-sm" data-vista="semana">Semana</button>
          <button class="btn btn-sm" data-vista="mes">Mes</button>
        </div>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-secondary btn-sm" id="ing-ant">‹</button>
          <strong id="ing-titulo" style="min-width:150px;text-align:center;font-size:14px;"></strong>
          <button class="btn btn-secondary btn-sm" id="ing-sig">›</button>
        </div>
      </div>
      <div id="ing-cuerpo"></div>
      <div id="ing-detalle" style="margin-top:10px;"></div>
    </div>`

  // ─── Hoy (todos los estudiantes) ───
  try {
    const resHoy = await conCopia(`ingreso-hoy:${hoy}:${estudiantes.map(e => e.id).join(',')}`, uid, async () => {
      const [regs, ...prim] = await Promise.all([
        api.registros({ desde: hoy, hasta: hoy, estudianteIds: estudiantes.map(e => e.id) }),
        ...estudiantes.map(e => primerDia(e.id)),
      ])
      return { regs, prim }
    })
    const { regs, prim } = resHoy.data
    avisoCopia(resHoy)
    const inicios = new Map(estudiantes.map((e, i) => [e.id, prim[i]]))
    cont.querySelector('#ing-hoy').innerHTML = `
      <div class="card"><div class="card-title">Hoy · ${api.fechaLarga(hoy, { weekday: 'long', day: 'numeric', month: 'long' })}</div>
      ${estudiantes.map(e => {
        const r = api.resumirDia(regs.filter(x => x.estudiante_id === e.id))
        const usa = inicios.get(e.id)
        const est = usa ? (api.ESTADOS[r.estado] ?? api.ESTADOS.sin_ingreso)
                        : { texto: 'Sin registro de portería', icono: '—', color: 'var(--color-text-3)', fondo: 'transparent' }
        return `<div style="display:flex;justify-content:space-between;gap:8px;padding:8px 0;border-top:1px solid var(--color-border);">
          <div><strong>${esc(e.nombre)}</strong>${e.curso ? `<div class="text-sm text-muted">${esc(e.curso)}</div>` : ''}</div>
          <div style="text-align:right;">
            <span class="badge" style="background:${est.fondo};color:${est.color};">${est.icono} ${est.texto}</span>
            <div class="text-sm">${r.entrada ? `Entró ${api.horaBolivia(r.entrada)}` : ''}${r.salida ? ` · Salió ${api.horaBolivia(r.salida)}` : ''}</div>
          </div></div>`
      }).join('')}</div>`
  } catch (e) {
    cont.querySelector('#ing-hoy').innerHTML = `<div class="card text-muted">No se pudo cargar: ${esc(e.message)}</div>`
  }

  const chips = cont.querySelector('#ing-chips')
  const pintarChips = () => {
    if (!chips) return
    chips.innerHTML = estudiantes.map(e => `<button class="btn btn-sm ${e.id === st.sel ? 'btn-primary' : 'btn-secondary'}" data-est="${e.id}">${esc(nombreCorto(e.nombre))}</button>`).join('')
    chips.querySelectorAll('[data-est]').forEach(b => b.onclick = () => { st.sel = b.dataset.est; pintarChips(); pintar() })
  }
  pintarChips()

  cont.querySelectorAll('[data-vista]').forEach(b => b.onclick = () => { st.vista = b.dataset.vista; st.ancla = hoy; pintar() })
  cont.querySelector('#ing-ant').onclick = () => mover(-1)
  cont.querySelector('#ing-sig').onclick = () => mover(1)

  function mover(n) {
    if (st.vista === 'semana') st.ancla = api.sumarDias(st.ancla, 7 * n)
    else { const d = new Date(st.ancla + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() + n); st.ancla = d.toISOString().slice(0, 10) }
    pintar()
  }

  async function pintar() {
    cont.querySelectorAll('[data-vista]').forEach(b => b.className = `btn btn-sm ${b.dataset.vista === st.vista ? 'btn-primary' : 'btn-secondary'}`)
    let desde, hasta
    if (st.vista === 'semana') { desde = api.lunesDe(st.ancla); hasta = api.sumarDias(desde, 6) }
    else { desde = st.ancla.slice(0, 8) + '01'; const d = new Date(desde + 'T12:00:00'); d.setMonth(d.getMonth() + 1); d.setDate(0); hasta = d.toISOString().slice(0, 10) }
    cont.querySelector('#ing-titulo').textContent = st.vista === 'semana'
      ? `${api.fechaLarga(desde, { day: 'numeric', month: 'short' })} – ${api.fechaLarga(hasta, { day: 'numeric', month: 'short' })}`
      : api.fechaLarga(desde, { month: 'long', year: 'numeric' })
    cont.querySelector('#ing-sig').disabled = hasta >= hoy
    const cuerpo = cont.querySelector('#ing-cuerpo')
    cont.querySelector('#ing-detalle').innerHTML = ''
    cuerpo.innerHTML = '<div class="text-muted text-sm">Cargando...</div>'
    let regs
    try {
      const res = await conCopia(`ingreso:${st.sel}:${desde}:${hasta}`, uid,
        () => api.registros({ desde, hasta, estudianteIds: [st.sel] }))
      regs = res.data ?? []
      avisoCopia(res)
    }
    catch (e) { cuerpo.innerHTML = `<div class="text-muted">${esc(e.message)}</div>`; return }
    const porDia = new Map()
    regs.forEach(r => { if (!porDia.has(r.fecha)) porDia.set(r.fecha, []); porDia.get(r.fecha).push(r) })

    const dias = []
    for (let f = desde; f <= hasta; f = api.sumarDias(f, 1)) dias.push(f)

    if (st.vista === 'semana') {
      cuerpo.innerHTML = dias.map(f => {
        const lista = porDia.get(f) ?? []
        // Sin registro NO se afirma ausencia (feriado, día sin clases o portería sin usar se ven igual)
        const futuro = !lista.length
        const r = api.resumirDia(lista)
        const e = api.ESTADOS[r.estado] ?? api.ESTADOS.sin_ingreso
        const finde = new Date(f + 'T12:00:00').getDay() % 6 === 0
        if (finde && !lista.length) return ''
        return `<div data-dia="${f}" style="display:flex;justify-content:space-between;gap:8px;padding:10px 4px;border-top:1px solid var(--color-border);cursor:pointer;">
          <span>${api.fechaLarga(f)}</span>
          ${futuro ? `<span class="text-muted text-sm">${textoSinRegistro(f)}</span>` : `<span style="text-align:right;">
            <span class="badge" style="background:${e.fondo};color:${e.color};">${e.icono} ${e.texto}</span>
            <span class="text-sm" style="display:block;">${r.entrada ? api.horaBolivia(r.entrada) : ''}${r.salida ? ` – ${api.horaBolivia(r.salida)}` : ''}</span></span>`}
        </div>`
      }).join('')
    } else {
      const offset = (new Date(desde + 'T12:00:00').getDay() + 6) % 7
      const celdas = Array(offset).fill('<div></div>').concat(dias.map(f => {
        const lista = porDia.get(f) ?? []
        const finde = new Date(f + 'T12:00:00').getDay() % 6 === 0
        const sinColor = !lista.length
        const e = api.ESTADOS[api.resumirDia(lista).estado] ?? api.ESTADOS.sin_ingreso
        const r = api.resumirDia(lista)
        return `<button data-dia="${f}" style="height:52px;border:1px solid var(--color-border);border-radius:8px;cursor:pointer;font-weight:600;padding:2px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1;${f === hoy ? 'outline:2px solid var(--color-primary);' : ''}
          background:${sinColor ? 'transparent' : e.fondo};color:${sinColor ? 'var(--color-text-3)' : e.color};">
          <span>${Number(f.slice(8))}</span>${!sinColor && r.entrada ? `<span style="font-size:10px;font-weight:500;">${api.horaBolivia(r.entrada)}</span>` : ''}</button>`
      }))
      cuerpo.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;max-width:460px;margin:0 auto;">
          ${DIAS.map(d => `<div class="text-sm text-muted" style="text-align:center;">${d}</div>`).join('')}${celdas.join('')}
        </div>
        <div class="text-sm" style="display:flex;gap:10px;flex-wrap:wrap;margin:8px auto 0;max-width:460px;">
          ${['a_tiempo', 'atraso', 'salida_anticipada', 'fuera_de_horario'].map(k => `<span>${api.ESTADOS[k].icono} ${api.ESTADOS[k].texto}</span>`).join('')}
          <span style="color:var(--color-text-3);">Sin color: sin registro de portería ese día</span>
        </div>`
    }
    cuerpo.querySelectorAll('[data-dia]').forEach(el => el.onclick = () => detalle(el.dataset.dia, porDia.get(el.dataset.dia) ?? []))
  }

  async function primerDia(id) {
    if (_inicio.has(id)) return _inicio.get(id)
    const { data, error } = await supabase.from('asistencia_porteria').select('fecha').eq('estudiante_id', id).order('fecha').limit(1)
    if (error) throw new Error(error.message)   // sin red: que se use la copia guardada
    const f = data?.[0]?.fecha ?? null
    _inicio.set(id, f)
    return f
  }

  function textoSinRegistro(f) {
    if (f > hoy) return 'Próximo'
    if (f === hoy) return '⚪ Aún no ingresó'
    return 'Sin registro'
  }

  function detalle(fecha, lista) {
    const r = api.resumirDia(lista)
    cont.querySelector('#ing-detalle').innerHTML = `
      <div style="background:var(--color-surface-2);border-radius:10px;padding:10px 12px;">
        <strong>${api.fechaLarga(fecha, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
        ${r.movimientos.length ? r.movimientos.map(m => {
          const e = api.ESTADOS[m.estado] ?? {}
          return `<div class="text-sm" style="margin-top:4px;">${m.tipo === 'entrada' ? '⬇ Entrada' : '⬆ Salida'} ${api.horaBolivia(m.hora)}
            ${e.texto ? `· ${e.icono} ${e.texto}` : ''}${m.motivo ? ` — ${esc(m.motivo)}` : ''}</div>`
        }).join('') : `<div class="text-sm text-muted" style="margin-top:4px;">${textoSinRegistro(fecha)}</div>`}
      </div>`
  }

  pintar()
}