// js/utils/promedio-anual.js
// Calcula y renderiza el promedio anual de un estudiante
// Promedio anual = (T1 + T2 + T3) / 3 — aprueba si >= notaMinima (51 por defecto)
// ─────────────────────────────────────────────────────────
import { supabase } from '../config/supabase-config.js'
import { escapeHtml } from './sanitize.js'
import { Config }   from '../config/config-app.js'
import { notaOficial, fmtNota, tituloExacto } from './estado-notas.js'
import { fetchConCache } from './data-layer.js'
import { insertarAvisoCopia } from './connection-status.js'

export async function calcularPromedioAnual(estudianteId, materiaIds = null) {
  let queryNotas = supabase
    .from('notas_finales')
    .select('materia_id, materia, trimestre, nota_final')
    .eq('estudiante_id', estudianteId)

  if (materiaIds?.length) queryNotas = queryNotas.in('materia_id', materiaIds)

  let queryNotasReales = supabase
    .from('notas')
    .select('actividad_id, actividades(materia_id, trimestre)')
    .eq('estudiante_id', estudianteId)

  // Copia guardada por estudiante: sin conexión se calcula con lo último descargado.
  const res = await fetchConCache({
    key: `promedio-anual:${(materiaIds ?? []).join(',')}`,
    colegioId: null, usuarioId: estudianteId,
    ms: 15000,
    run: async () => {
      const [rN, rR] = await Promise.all([queryNotas, queryNotasReales])
      const err = rN.error ?? rR.error
      return { data: err ? null : { notas: rN.data ?? [], reales: rR.data ?? [] }, error: err }
    },
  })
  const salida = (lista) => Object.assign(lista, { offline: !!res.offline, syncedAt: res.syncedAt, error: res.error })
  if (res.error) return salida([])
  const data = res.data?.notas ?? []
  const notasReales = res.data?.reales ?? []

  if (!data.length) return salida([])

  const trimestresConNota = new Set()
  for (const n of (notasReales ?? [])) {
    const mat = n.actividades?.materia_id
    const tri = n.actividades?.trimestre
    if (mat && tri) trimestresConNota.add(`${mat}_${tri}`)
  }

  const porMateria = {}
  for (const n of data) {
    if (!porMateria[n.materia_id]) {
      porMateria[n.materia_id] = { materia_id: n.materia_id, materia: n.materia, t1: null, t2: null, t3: null }
    }
    const val = parseFloat(n.nota_final ?? 0)
    const tieneNotaInsertada = trimestresConNota.has(`${n.materia_id}_${n.trimestre}`)
    if (tieneNotaInsertada) {
      porMateria[n.materia_id][`t${n.trimestre}`] = val
    }
  }

  const notaMin = Config.notaMinima ?? 51

  return salida(Object.values(porMateria)
    .map(m => {
      const notas = [m.t1, m.t2, m.t3].filter(v => v !== null)
      // Oficial: promedio de los trimestres redondeados, redondeado. Exacto: para desempates/tooltip
      const promedio = notas.length ? notaOficial(notas.reduce((s, v) => s + notaOficial(v), 0) / notas.length) : null
      const promedioExacto = notas.length ? Math.round((notas.reduce((s, v) => s + v, 0) / notas.length) * 100) / 100 : null
      const completo = notas.length === 3
      const estado = promedio === null
        ? '—'
        : (!completo || !Config.bloqueada)   // anual: solo se afirma al cerrar la gestión
          ? 'En curso'
          : promedio >= notaMin ? Config.etiqAprobado ?? 'APROBADO' : Config.etiqReprobado ?? 'REPROBADO'
      return { ...m, promedio, promedioExacto, trimestresConNota: notas.length, completo, estado }
    })
    .filter(m => m.promedio !== null)
    .sort((a, b) => a.materia?.localeCompare(b.materia)))
}

export async function renderizarPromedioAnual(containerId, estudianteId, materiaIds = null) {
  const el = document.getElementById(containerId)
  if (!el) return

  el.innerHTML = `<div style="text-align:center;padding:24px;color:var(--color-text-3);">⏳ Cargando promedio anual...</div>`

  const datos = await calcularPromedioAnual(estudianteId, materiaIds)
  const notaMin = Config.notaMinima ?? 51

  if (datos.error) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No se pudo cargar el promedio anual</div>
        <div class="empty-state-desc">${escapeHtml(datos.error.message ?? String(datos.error))}</div>
      </div>`
    return
  }

  if (!datos.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📊</div>
        <div class="empty-state-title">Sin notas para calcular promedio anual</div>
        <div class="empty-state-desc">Se necesitan notas de al menos un trimestre</div>
      </div>`
    if (datos.offline) insertarAvisoCopia(el, datos.syncedAt)
    return
  }

  const totalMaterias   = datos.length
  const aprobadas       = datos.filter(m => m.estado === (Config.etiqAprobado ?? 'APROBADO')).length
  const reprobadas      = datos.filter(m => m.estado === (Config.etiqReprobado ?? 'REPROBADO')).length
  const enCurso         = totalMaterias - aprobadas - reprobadas   // gestión abierta o trimestres faltantes
  const svgI = (d, c) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px" aria-hidden="true">${d}</svg>`
  const IC_OK     = svgI('<polyline points="20 6 9 17 4 12"/>', '#16a34a')
  const IC_MAL    = svgI('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', '#dc2626')
  const IC_CURSO  = svgI('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', '#854d0e')
  const promedioGeneral = notaOficial(datos.reduce((s, m) => s + m.promedio, 0) / totalMaterias)
  const añoCompleto     = datos.every(m => m.completo) && !!Config.bloqueada   // se afirma solo con la gestión cerrada
  const estadoGeneral   = promedioGeneral >= notaMin

  const periodos = Config.periodos ?? [
    { numero: 1, nombre: 'Trimestre 1' },
    { numero: 2, nombre: 'Trimestre 2' },
    { numero: 3, nombre: 'Trimestre 3' },
  ]

  // Generar filas fuera del template literal para evitar problemas de scope
  const filas = datos.map((m, i) => {
    const aprobado = m.promedio >= notaMin
    const bgRow = i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-bg)'
    const bgPromedio = aprobado ? '#d1fae5' : '#fee2e2'
    const colorPromedio = aprobado ? '#065f46' : '#991b1b'
    const badgeClass = m.estado === 'En curso' ? 'badge-warning' : (aprobado ? 'badge-success' : 'badge-error')

    const celdasTrimestres = periodos.map(p => {
      const val = m[`t${p.numero}`]
      if (val !== null) {
        const colorVal = notaOficial(val) >= notaMin ? '#065f46' : '#991b1b'
        return `<td style="padding:11px 16px;text-align:center;"><span style="font-weight:600;color:${colorVal};" title="${tituloExacto(val)}">${fmtNota(val)}</span></td>`
      }
      return `<td style="padding:11px 16px;text-align:center;"><span style="color:var(--color-text-3);">—</span></td>`
    }).join('')

    return `<tr style="border-top:1px solid var(--color-border);background:${bgRow};">
      <td style="padding:11px 16px;font-weight:600;">${escapeHtml(m.materia)}</td>
      ${celdasTrimestres}
      <td style="padding:11px 16px;text-align:center;">
        <span style="display:inline-flex;align-items:baseline;gap:2px;padding:5px 12px;border-radius:99px;font-size:14px;font-weight:700;background:${bgPromedio};color:${colorPromedio};">
          <span title="${tituloExacto(m.promedioExacto)}">${fmtNota(m.promedio)}</span><small style="font-size:11px;font-weight:400;opacity:.7;">/100</small>
        </span>
      </td>
      <td style="padding:11px 16px;text-align:center;">
        <span class="badge ${badgeClass}">${m.estado}</span>
      </td>
    </tr>`
  }).join('')

  const headersTrimestres = periodos.map(p =>
    `<th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:600;background:transparent;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">${p.nombre}</th>`
  ).join('')

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
      <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:11px;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Promedio General</div>
        <div style="font-size:28px;font-weight:800;color:${estadoGeneral ? '#065f46' : '#991b1b'};">${fmtNota(promedioGeneral)}</div>
        <div style="font-size:10px;color:var(--color-text-3);">/ 100 pts</div>
      </div>
      <div style="background:${!añoCompleto ? '#fef9c3' : estadoGeneral ? '#d1fae5' : '#fee2e2'};border:1px solid ${!añoCompleto ? '#fde047' : estadoGeneral ? '#6ee7b7' : '#fca5a5'};border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:11px;font-weight:600;color:${!añoCompleto ? '#854d0e' : estadoGeneral ? '#065f46' : '#991b1b'};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Estado Anual</div>
        <div style="font-size:20px;font-weight:800;color:${!añoCompleto ? '#854d0e' : estadoGeneral ? '#065f46' : '#991b1b'};">${!añoCompleto ? IC_CURSO + ' En curso' : estadoGeneral ? IC_OK + ' APRUEBA' : IC_MAL + ' REPRUEBA'}</div>
        <div style="font-size:10px;color:${!añoCompleto ? '#854d0e' : estadoGeneral ? '#065f46' : '#991b1b'};">${!añoCompleto ? (datos.every(m => m.completo) ? 'Gestión aún no cerrada' : `Basado en ${datos[0]?.trimestresConNota ?? 1} de 3 trimestres`) : `Mínimo: ${notaMin} pts`}</div>
      </div>
      <div style="background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:16px;text-align:center;">
        <div style="font-size:11px;font-weight:600;color:var(--color-text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;">Materias</div>
        ${enCurso === totalMaterias
          ? `<div style="font-size:22px;font-weight:800;color:#854d0e;">${totalMaterias} ${IC_CURSO}</div>
             <div style="font-size:11px;color:#854d0e;">en curso</div>`
          : `<div style="font-size:22px;font-weight:800;color:#065f46;">${aprobadas} ${IC_OK}</div>
             <div style="font-size:11px;color:${reprobadas > 0 ? '#991b1b' : '#065f46'};">${[
               reprobadas > 0 ? reprobadas + ' reprobada' + (reprobadas > 1 ? 's' : '') : '',
               enCurso > 0 ? enCurso + ' en curso' : '',
             ].filter(Boolean).join(' · ') || 'Todas aprobadas'}</div>`}
      </div>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px;border:1px solid var(--color-border);">
      <table style="width:100%;border-collapse:collapse;font-size:13.5px;background:var(--color-surface);">
        <thead>
          <tr style="background:linear-gradient(135deg,#1e1b4b 0%,#4f46e5 100%);">
            <th style="padding:12px 16px;text-align:left;font-size:11px;font-weight:600;background:transparent;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;">Materia</th>
            ${headersTrimestres}
            <th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:600;background:transparent;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:.06em;">Promedio</th>
            <th style="padding:12px 16px;text-align:center;font-size:11px;font-weight:600;background:transparent;color:rgba(255,255,255,0.85);text-transform:uppercase;letter-spacing:.06em;">Estado</th>
          </tr>
        </thead>
        <tbody>${filas}</tbody>
      </table>
    </div>
    <div style="margin-top:10px;font-size:11px;color:var(--color-text-3);text-align:right;">
      Promedio anual = (T1 + T2 + T3) ÷ trimestres con nota, con notas redondeadas (.5 sube) · Aprueba con ≥ ${notaMin} pts · Pasa el mouse sobre una nota para ver la exacta
    </div>`
  if (datos.offline) insertarAvisoCopia(el, datos.syncedAt)
}
// Trae TODAS las filas de una consulta, sin depender del límite de 1000
// filas que Supabase/PostgREST corta por defecto en cualquier select sin
// paginar. Sin esto, un colegio con muchos estudiantes/materias pierde
// filas de forma no determinística (el orden de corte no está garantizado
// sin ORDER BY), lo que hacía que un mismo estudiante apareciera bien o
// mal calculado según el momento en que se ejecutaba la consulta.
async function _fetchAllPaginado(queryBuilder, ordenCol) {
  const PAGE = 1000
  let offset = 0
  let todos = []
  while (true) {
    const { data, error } = await queryBuilder.order(ordenCol).range(offset, offset + PAGE - 1)
    if (error) return { data: null, error }
    todos = todos.concat(data ?? [])
    if (!data || data.length < PAGE) break
    offset += PAGE
  }
  return { data: todos, error: null }
}

export async function calcularPromedioAnualLote(estudianteIds, materiaIds = null) {
  if (!estudianteIds?.length) return {}

  let queryNotas = supabase
    .from('notas_finales')
    .select('estudiante_id, materia_id, materia, trimestre, nota_final')
    .in('estudiante_id', estudianteIds)
  if (materiaIds?.length) queryNotas = queryNotas.in('materia_id', materiaIds)

  let queryNotasReales = supabase
    .from('notas')
    .select('estudiante_id, actividad_id, actividades!inner(materia_id, trimestre)')
    .in('estudiante_id', estudianteIds)
  if (materiaIds?.length) queryNotasReales = queryNotasReales.in('actividades.materia_id', materiaIds)

  const [{ data, error }, { data: notasReales, error: error2 }] = await Promise.all([
    _fetchAllPaginado(queryNotas, 'estudiante_id'),
    _fetchAllPaginado(queryNotasReales, 'estudiante_id')
  ])
  if (error) console.error('calcularPromedioAnualLote notas_finales:', error)
  if (error2) console.error('calcularPromedioAnualLote notas:', error2)

  const trimSetPorEst = {}
  for (const n of (notasReales ?? [])) {
    const mat = n.actividades?.materia_id
    const tri = n.actividades?.trimestre
    if (!mat || !tri) continue
    if (!trimSetPorEst[n.estudiante_id]) trimSetPorEst[n.estudiante_id] = new Set()
    trimSetPorEst[n.estudiante_id].add(`${mat}_${tri}`)
  }

  const porEstudiante = {}
  for (const n of (data ?? [])) {
    if (!porEstudiante[n.estudiante_id]) porEstudiante[n.estudiante_id] = {}
    const porMateria = porEstudiante[n.estudiante_id]
    if (!porMateria[n.materia_id]) {
      porMateria[n.materia_id] = { materia_id: n.materia_id, materia: n.materia, t1: null, t2: null, t3: null }
    }
    const val = parseFloat(n.nota_final ?? 0)
    if (trimSetPorEst[n.estudiante_id]?.has(`${n.materia_id}_${n.trimestre}`)) {
      porMateria[n.materia_id][`t${n.trimestre}`] = val
    }
  }

  const notaMin = Config.notaMinima ?? 51
  const resultado = {}
  for (const estId of estudianteIds) {
    resultado[estId] = Object.values(porEstudiante[estId] ?? {})
      .map(m => {
        const notas = [m.t1, m.t2, m.t3].filter(v => v !== null)
        // Oficial: promedio de los trimestres redondeados, redondeado. Exacto: para desempates/tooltip
        const promedio = notas.length ? notaOficial(notas.reduce((s, v) => s + notaOficial(v), 0) / notas.length) : null
        const promedioExacto = notas.length ? Math.round((notas.reduce((s, v) => s + v, 0) / notas.length) * 100) / 100 : null
        const completo = notas.length === 3
        const estado = promedio === null ? '—' : (!completo || !Config.bloqueada) ? 'En curso'
          : promedio >= notaMin ? Config.etiqAprobado ?? 'APROBADO' : Config.etiqReprobado ?? 'REPROBADO'
        return { ...m, promedio, promedioExacto, trimestresConNota: notas.length, completo, estado }
      })
      .filter(m => m.promedio !== null)
      .sort((a, b) => a.materia?.localeCompare(b.materia))
  }
  return resultado
}