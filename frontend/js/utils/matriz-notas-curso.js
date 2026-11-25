// js/utils/matriz-notas-curso.js
// Grilla de SOLO LECTURA: todo el curso × (actividades de cada dimensión + promedio,
// SER, Autoevaluación y Total). Equivale en pantalla a la "Vista consolidada" del Excel.
//
// Igual que utils/grilla-asistencia.js, este módulo NO consulta datos: solo dibuja lo que
// le pasa quien lo llama (profesor/vista-calificaciones.js).
//   · Escritorio y tablet: tabla con scroll horizontal, columna de estudiante fija.
//   · Móvil (≤ 768 px): lista por estudiante (<details>) con sus actividades y observaciones.
//
// API:
//   montarMatrizNotas(contenedor, ctx)
//   ctx = {
//     estudiantes:  [{ id, usuarios: { nombre_completo } }],
//     actividades:  [{ id, titulo, tipo, max_puntos, created_at }],
//     notasMap:     { 'actId_estId': valor },
//     obsMap:       { 'actId_estId': 'observación' },
//     resumen:      { estId: { [codigoDim]: nota|null, total } }   // _calcularResumen()
//     dimensiones:  Config.dimensiones,
//     colorDim:     (codigo) => '#hex',
//     trimestreAbierto: boolean,        // abierto => el Total no se pinta aprobado/reprobado
//     notaMinima, escalaMaxima,
//     onActividad:  (actividadId) => void   // tocar una cabecera de actividad
//   }
import { escapeHtml } from './sanitize.js'
import { notaOficial, fmtNota, tituloExacto } from './estado-notas.js'

// Filtros: persisten mientras la página siga abierta (el panel se redibuja al guardar notas).
const _est = { dim: '', q: '', orden: '', pend: false }
let _ctx = null
let _cont = null

// ─── API ─────────────────────────────────────────────────
export function montarMatrizNotas(contenedor, ctx) {
  _cont = contenedor
  _ctx = ctx

  if (!ctx.actividades.length) {
    contenedor.innerHTML = `<div class="empty-state"><div class="empty-state-title">Aún no hay actividades en este período</div></div>`
    return
  }
  if (_est.dim && !ctx.dimensiones.some(d => d.codigo === _est.dim)) _est.dim = ''

  contenedor.innerHTML = `
    <div class="mn-barra">
      <select class="vc-select" data-mn="dim" aria-label="Filtrar por dimensión">
        <option value="">Todas las dimensiones</option>
        ${_dimsOrdenadas().map(d => `<option value="${escapeHtml(d.codigo)}"${d.codigo === _est.dim ? ' selected' : ''}>${escapeHtml(d.nombre)}</option>`).join('')}
      </select>
      <select class="vc-select" data-mn="orden" aria-label="Ordenar">
        <option value=""${_est.orden === '' ? ' selected' : ''}>Orden alfabético</option>
        <option value="asc"${_est.orden === 'asc' ? ' selected' : ''}>Total: menor a mayor</option>
        <option value="desc"${_est.orden === 'desc' ? ' selected' : ''}>Total: mayor a menor</option>
      </select>
      <input type="search" data-mn="q" placeholder="Buscar estudiante..." value="${escapeHtml(_est.q)}" aria-label="Buscar estudiante" name="mn-buscar-estudiante" autocomplete="off" readonly onfocus="this.removeAttribute('readonly')">
      <label class="mn-check"><input type="checkbox" data-mn="pend"${_est.pend ? ' checked' : ''}> Solo con actividades sin nota</label>
    </div>
    <div class="mn-detalle"></div>
    <div class="mn-resultado"></div>`

  // Asignación directa (no addEventListener): si se vuelve a montar en el mismo nodo no se duplican.
  contenedor.onchange = (ev) => {
    const t = ev.target
    if (t.dataset.mn === 'dim')   { _est.dim = t.value; _pintar() }
    if (t.dataset.mn === 'orden') { _est.orden = t.value; _pintar() }
    if (t.dataset.mn === 'pend')  { _est.pend = t.checked; _pintar() }
  }
  contenedor.oninput = (ev) => {
    if (ev.target.dataset.mn === 'q') { _est.q = ev.target.value; _pintar() }
  }
  contenedor.onclick = (ev) => {
    const th = ev.target.closest('.mn-th-act')
    if (th) { _ctx.onActividad?.(th.dataset.act); return }
    const td = ev.target.closest('td.mn-nota')
    if (td) _mostrarDetalle(td)
  }

  _pintar()
}

// ─── Estructura de columnas ──────────────────────────────
function _dimsOrdenadas() {
  return [..._ctx.dimensiones].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
}

// H, S, … ; si dos dimensiones empiezan igual se alarga el prefijo (DE, DI).
function _prefijos(dims) {
  const usados = new Set()
  const out = {}
  for (const d of dims) {
    const base = String(d.codigo).toUpperCase()
    let n = 1
    let p = base.slice(0, n)
    while (usados.has(p) && n < base.length) { n++; p = base.slice(0, n) }
    usados.add(p)
    out[d.codigo] = p
  }
  return out
}

function _grupos() {
  const todas = _dimsOrdenadas()
  const prefijos = _prefijos(todas)
  return todas
    .filter(d => !_est.dim || d.codigo === _est.dim)
    .map(dim => {
      const color = _ctx.colorDim(dim.codigo)
      let cols
      if (dim.tipo === 'actividades') {
        const acts = _ctx.actividades
          .filter(a => a.tipo === dim.codigo)
          .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
        cols = acts.map((a, i) => ({ k: 'act', act: a, codigo: `${prefijos[dim.codigo]}${i + 1}` }))
        cols.push({ k: 'prom' })
      } else {
        cols = [{ k: 'dim' }]
      }
      return { dim, color, cols }
    })
}

// ─── Helpers de datos ────────────────────────────────────
const _nombre = (e) => e.usuarios?.nombre_completo ?? '—'
const _key = (a, e) => `${a.id}_${e.id}`

function _nota(a, e) {
  const v = _ctx.notasMap[_key(a, e)]
  return v == null ? null : parseFloat(v)
}

function _fmt(v) { return String(Math.round(v * 100) / 100) }

function _bajo(valor, max) {
  return max > 0 && (valor / max) < (_ctx.notaMinima / _ctx.escalaMaxima)
}

function _sinNada(r) {
  return _ctx.dimensiones.every(d => r[d.codigo] == null)
}

function _totalHtml(r) {
  if (!r || _sinNada(r)) return `<span class="mn-vacio">—</span>`
  const t = r.total ?? 0
  let cls = 'mn-total--neutro'
  if (!_ctx.trimestreAbierto) cls = notaOficial(t) >= _ctx.notaMinima ? 'mn-total--ok' : 'mn-total--mal'
  return `<span class="mn-total ${cls}" title="${tituloExacto(t)}">${fmtNota(t)}</span>`
}

function _estudiantesVisibles(grupos) {
  const nums = {}
  _ctx.estudiantes.forEach((e, i) => { nums[e.id] = i + 1 })

  let lista = _ctx.estudiantes.slice()
  const q = _est.q.trim().toLowerCase()
  if (q) lista = lista.filter(e => _nombre(e).toLowerCase().includes(q))
  if (_est.pend) {
    const acts = grupos.flatMap(g => g.cols.filter(c => c.k === 'act').map(c => c.act))
    lista = lista.filter(e => acts.some(a => _nota(a, e) == null))
  }
  if (_est.orden) {
    const t = (e) => _ctx.resumen[e.id]?.total ?? 0
    lista.sort((a, b) => _est.orden === 'asc' ? t(a) - t(b) : t(b) - t(a))
  }
  return { lista, nums }
}

// ─── Pintado ─────────────────────────────────────────────
function _pintar() {
  const res = _cont.querySelector('.mn-resultado')
  const det = _cont.querySelector('.mn-detalle')
  if (!res) return
  det.innerHTML = ''

  const grupos = _grupos()
  const { lista, nums } = _estudiantesVisibles(grupos)
  if (!lista.length) {
    res.innerHTML = `<div class="empty-state"><div class="empty-state-title">Ningún estudiante coincide con el filtro</div></div>`
    return
  }
  res.innerHTML = `
    <div class="mn-scroll">${_htmlTabla(grupos, lista, nums)}</div>
    <div class="mn-lista"><div class="text-sm text-muted" style="margin-bottom:8px;">Toca un estudiante para ver sus notas por actividad.</div>${_htmlLista(grupos, lista, nums)}</div>
    <div class="mn-leyenda">${lista.length} de ${_ctx.estudiantes.length} estudiantes.
      Toca una nota para ver su detalle y observación (esquina marcada = tiene observación). Toca H1, S1… para ver la estadística de la actividad.</div>`
}

function _htmlTabla(grupos, lista, nums) {
  const filaGrupos = `<tr>
    <th class="mn-th-nom" rowspan="2">Estudiante</th>
    ${grupos.map(g => `<th class="mn-grp" colspan="${g.cols.length}" style="--dim-color:${g.color};">${escapeHtml(g.dim.nombre)} <small>(${g.dim.peso_maximo})</small></th>`).join('')}
    <th class="mn-grp mn-grp-total" rowspan="2">Total <small>(${_ctx.escalaMaxima})</small></th>
  </tr>`

  const filaCols = `<tr>${grupos.map(g => g.cols.map(c => {
    if (c.k === 'act') {
      return `<th class="mn-th mn-th-act" data-act="${escapeHtml(c.act.id)}" style="--dim-color:${g.color};" title="${escapeHtml(c.act.titulo)}">
        <b>${c.codigo}</b><small>/${c.act.max_puntos}</small><span class="mn-th-titulo">${escapeHtml(c.act.titulo)}</span></th>`
    }
    const etiqueta = c.k === 'prom' ? 'Prom.' : 'Nota'
    return `<th class="mn-th mn-th-prom" style="--dim-color:${g.color};"><b>${etiqueta}</b><small>/${g.dim.peso_maximo}</small></th>`
  }).join('')).join('')}</tr>`

  const filas = lista.map(e => {
    const r = _ctx.resumen[e.id] ?? {}
    const celdas = grupos.map(g => g.cols.map(c => {
      if (c.k === 'act') {
        const v = _nota(c.act, e)
        const attrs = `data-act="${escapeHtml(c.act.id)}" data-est="${escapeHtml(e.id)}" data-cod="${c.codigo}"`
        if (v == null) return `<td class="mn-nota mn-vacio" ${attrs}>—</td>`
        const cls = 'mn-nota' + (_bajo(v, parseFloat(c.act.max_puntos)) ? ' mn-bajo' : '') + (_ctx.obsMap?.[_key(c.act, e)] ? ' mn-obs' : '')
        return `<td class="${cls}" ${attrs}>${_fmt(v)}</td>`
      }
      const val = r[g.dim.codigo]
      if (val == null) return `<td class="mn-prom mn-vacio" style="--dim-color:${g.color};">—</td>`
      return `<td class="mn-prom${_bajo(val, g.dim.peso_maximo) ? ' mn-bajo' : ''}" style="--dim-color:${g.color};" title="${tituloExacto(val)}">${fmtNota(val)}</td>`
    }).join('')).join('')
    return `<tr>
      <td class="mn-nom"><span class="mn-n">${nums[e.id]}</span>${escapeHtml(_nombre(e))}</td>
      ${celdas}
      <td class="mn-tot">${_totalHtml(r)}</td>
    </tr>`
  }).join('')

  return `<table class="mn-tabla">
    <thead>${filaGrupos}${filaCols}</thead>
    <tbody>${filas}</tbody>
    <tfoot>${_htmlPie(grupos)}</tfoot>
  </table>`
}

// Pie: cuántos están calificados y el promedio del curso por columna (todos los estudiantes del curso).
function _htmlPie(grupos) {
  const n = _ctx.estudiantes.length
  const avg = (vals) => vals.length ? (vals.reduce((s, v) => s + v, 0) / vals.length) : null
  let cal = '', prom = ''
  for (const g of grupos) {
    for (const c of g.cols) {
      const vals = c.k === 'act'
        ? _ctx.estudiantes.map(e => _nota(c.act, e)).filter(v => v != null)
        : _ctx.estudiantes.map(e => _ctx.resumen[e.id]?.[g.dim.codigo]).filter(v => v != null)
      const p = avg(vals)
      cal  += `<td>${vals.length}/${n}</td>`
      prom += `<td title="${tituloExacto(p)}">${fmtNota(p)}</td>`
    }
  }
  const totales = _ctx.estudiantes.map(e => _ctx.resumen[e.id]).filter(r => r && !_sinNada(r)).map(r => r.total ?? 0)
  const pt = avg(totales)
  return `
    <tr class="mn-pie"><td class="mn-nom">Calificados</td>${cal}<td></td></tr>
    <tr class="mn-pie"><td class="mn-nom">Promedio del curso</td>${prom}<td title="${tituloExacto(pt)}">${fmtNota(pt)}</td></tr>`
}

// Móvil: una tarjeta desplegable por estudiante.
function _htmlLista(grupos, lista, nums) {
  return lista.map(e => {
    const r = _ctx.resumen[e.id] ?? {}
    const chips = grupos.map(g => {
      const v = r[g.dim.codigo]
      return `<span class="mn-chip" style="--dim-color:${g.color};">${escapeHtml(g.dim.nombre)} <b>${fmtNota(v)}</b></span>`
    }).join('')

    const cuerpo = grupos.map(g => {
      let filas = ''
      if (g.dim.tipo === 'actividades') {
        const acts = g.cols.filter(c => c.k === 'act')
        filas = acts.length ? acts.map(c => {
          const v = _nota(c.act, e)
          const obs = _ctx.obsMap?.[_key(c.act, e)]
          return `<div class="mn-fila"><span>${c.codigo} · ${escapeHtml(c.act.titulo)}</span>
              <b class="${v != null && _bajo(v, parseFloat(c.act.max_puntos)) ? 'mn-bajo' : (v == null ? 'mn-vacio' : '')}">${v == null ? '—' : `${_fmt(v)} / ${c.act.max_puntos}`}</b></div>
            ${obs ? `<div class="mn-fila-obs">${escapeHtml(obs)}</div>` : ''}`
        }).join('') : `<div class="mn-fila mn-vacio">Sin actividades</div>`
      } else {
        const v = r[g.dim.codigo]
        filas = `<div class="mn-fila"><span>Nota</span><b class="${v == null ? 'mn-vacio' : ''}">${v == null ? '—' : `${fmtNota(v)} / ${g.dim.peso_maximo}`}</b></div>`
      }
      return `<div class="mn-body-dim" style="--dim-color:${g.color};">${escapeHtml(g.dim.nombre)} <small>(${g.dim.peso_maximo})</small></div>${filas}`
    }).join('')

    return `<details class="mn-card">
      <summary>
        <div class="mn-card-top"><span>${nums[e.id]}. ${escapeHtml(_nombre(e))}</span>${_totalHtml(r)}</div>
        <div class="mn-chips">${chips}</div>
      </summary>
      <div class="mn-card-body">${cuerpo}</div>
    </details>`
  }).join('')
}

// Escritorio/tablet: tocar una nota muestra su detalle y observación sobre la tabla.
function _mostrarDetalle(td) {
  const act = _ctx.actividades.find(a => a.id === td.dataset.act)
  const est = _ctx.estudiantes.find(e => e.id === td.dataset.est)
  const det = _cont.querySelector('.mn-detalle')
  if (!act || !est || !det) return

  _cont.querySelectorAll('.mn-sel').forEach(x => x.classList.remove('mn-sel'))
  td.classList.add('mn-sel')

  const v = _nota(act, est)
  const obs = _ctx.obsMap?.[_key(act, est)]
  const max = parseFloat(act.max_puntos)
  det.innerHTML = `<div class="mn-detalle-card">
    <strong>${escapeHtml(_nombre(est))}</strong> · ${escapeHtml(td.dataset.cod)} · ${escapeHtml(act.titulo)}
    <div>${v == null ? 'Sin nota' : `Nota: <b>${_fmt(v)}</b> / ${act.max_puntos} (${max > 0 ? Math.round(v / max * 100) : 0}%)`}</div>
    <div class="mn-detalle-obs">${obs ? escapeHtml(obs) : 'Sin observación.'}</div>
  </div>`
  det.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}
