// js/admin/reportes-director.js
// Módulo de Reportes del Director — Gestión Educativa 2027
// 4 reportes: Aprovechamiento (Excel oficial), Excelencia, Semáforo de Riesgo, Rendimiento por Materia

import { supabase }                         from '../config/supabase-config.js'
import { Config }                            from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from '../utils/ui.js'
import { escapeHtml } from '../utils/sanitize.js'
import { estadoTrimestre, promedioAnual, esAlerta, trimestreCerrado, notaOficial, fmtNota, tituloExacto } from '../utils/estado-notas.js'

// ─── CONSTANTES ────────────────────────────────────────────────
const EXCELENCIA_HONOR = 97
const EXCELENCIA_BASE  = 95

// Misma regla que Bajo Rendimiento, Junta y panel del asesor (utils/estado-notas.js)
const _ctx = () => ({
  trimestreActivo: Config.trimestreActivo, bloqueada: Config.bloqueada, notaMinima: Config.notaMinima,
  etiqAprobado: Config.etiqAprobado, etiqReprobado: Config.etiqReprobado,
  numPeriodos: (Config.periodos ?? []).length || 3,
})
const _nombrePeriodo = p => p === 'anual' ? 'Anual' : (Config.periodos?.find(x => x.numero === p)?.nombre ?? 'Trimestre ' + p)
const _abierto = p => p !== 'anual' && !trimestreCerrado(p, _ctx())
const MSG_SIN_NOTAS = 'Sin notas registradas en el sistema para este período'

// ─── INIT ──────────────────────────────────────────────────────
export function initReportesDirector() {
  _poblarFiltros()

  // Tabs
  document.querySelectorAll('.rep-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rep-tab').forEach(b => {
        b.classList.remove('btn-primary')
        b.classList.add('btn-secondary')
      })
      btn.classList.add('btn-primary')
      btn.classList.remove('btn-secondary')
      const rep = btn.dataset.rep
      document.getElementById('rep-btn-exportar-wrap').style.display =
        rep === 'aprovechamiento' ? 'block' : 'none'
      _cargarReporte(rep)
    })
  })

    // Filtros no disparan carga (mismo patrón que Calificaciones / Asistencias)
  // Solo el botón Ver y el cambio de pestaña de reporte
  document.getElementById('rep-btn-ver')?.addEventListener('click', _recargarActivo)

  // Botón exportar Excel
  document.getElementById('rep-btn-exportar')?.addEventListener('click', exportarAprovechamientoExcel)

  // Al entrar: solo interfaz, sin consulta pesada
}

function _poblarFiltros() {
  const sel = document.getElementById('rep-periodo')
  if (!sel) return
  sel.innerHTML = (Config.periodos ?? []).map(p =>
    `<option value="${p.numero}" ${p.numero === Config.trimestreActivo ? 'selected' : ''}>
      ${escapeHtml(p.nombre)}
    </option>`
  ).join('') + '<option value="anual">Anual</option>'
}

function _getFiltros() {
  return {
    periodo: (v => v === 'anual' ? 'anual' : parseInt(v))(document.getElementById('rep-periodo')?.value ?? String(Config.trimestreActivo)),
    nivel:   document.getElementById('rep-nivel')?.value ?? ''
  }
}

function _getTabActivo() {
  return document.querySelector('.rep-tab.btn-primary')?.dataset.rep ?? 'aprovechamiento'
}

function _recargarActivo() {
  _cargarReporte(_getTabActivo())
}

function _cargarReporte(rep) {
  const { periodo, nivel } = _getFiltros()
  if (periodo === 'anual' && rep !== 'semaforo') {
    document.getElementById('rep-contenido').innerHTML =
      _empty('La vista Anual está disponible en el Semáforo de Riesgo. Para este reporte elige un trimestre.')
    return
  }
  switch (rep) {
    case 'aprovechamiento': return renderAprovechamiento(periodo, nivel)
    case 'excelencia':      return renderExcelencia(periodo, nivel)
    case 'semaforo':        return renderSemaforo(periodo, nivel)
    case 'rendimiento':     return renderRendimiento(periodo, nivel)
  }
}

// ─── QUERY BASE ────────────────────────────────────────────────
// ─── QUERY BASE ────────────────────────────────────────────────
async function _getNotas(periodo, nivel) {
  const { data, error } = await supabase.rpc('reporte_notas_periodo', {
    p_trimestre: periodo,
    p_nivel: nivel || null,
  })
  if (error) throw error
  return data ?? []
}

// ─── REPORTE 1: APROVECHAMIENTO ─────────────────────────────────
async function renderAprovechamiento(periodo, nivel) {
  const cont = document.getElementById('rep-contenido')
  cont.innerHTML = _loading()
  mostrarLoader('Cargando aprovechamiento...')
  try {
    const notas = await _getNotas(periodo, nivel)
    if (!notas.length) { cont.innerHTML = _empty(MSG_SIN_NOTAS); return }

    // Un registro por alumno+materia. El 0 registrado por el profesor cuenta en "En desarrollo (1-50)"
    // (la RPC ya excluye filas sin ninguna calificación — migración 089)
    const porMateria = {}
    const vistos = new Set()
    notas.forEach(r => {
      const nota = parseFloat(r.nota_final)
      if (!(nota >= 0)) return
      const key = `${r.estudiante_id}|${r.materia_id}`
      if (vistos.has(key)) return
      vistos.add(key)
      if (!porMateria[r.materia_id]) porMateria[r.materia_id] = { nombre: r.materia, notas: [] }
      porMateria[r.materia_id].notas.push(notaOficial(nota))   // rangos con la nota oficial (redondeada)
    })

    const filas = Object.values(porMateria).map(m => {
      const ns   = m.notas
      const total = ns.length
      // Cortes alineados con Aprobado/Reprobado (nota < 51 = En desarrollo), válidos con decimales
      const ed   = ns.filter(n => parseFloat(n) < 51).length
      const da   = ns.filter(n => parseFloat(n) >= 51 && parseFloat(n) < 69).length
      const dopt = ns.filter(n => parseFloat(n) >= 69 && parseFloat(n) < 86).length
      const dp   = ns.filter(n => parseFloat(n) >= 86).length
      return { nombre: m.nombre, total, ed, da, dopt, dp,
        pED: _pct(ed, total), pDA: _pct(da, total),
        pDO: _pct(dopt, total), pDP: _pct(dp, total) }
    }).sort((a, b) => a.nombre.localeCompare(b.nombre))

    cont.innerHTML = _avisoAbierto(periodo) + `
      <div class="card" style="padding:0;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--color-border);">
          <span class="card-title" style="margin:0;">
            Aprovechamiento por Área Curricular — ${Config.periodos?.find(p=>p.numero===periodo)?.nombre ?? 'Trimestre '+periodo}
          </span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Área Curricular</th>
                <th style="text-align:center;background:#fee2e2;">En Desarrollo<br><small>(1-50)</small></th>
                <th style="text-align:center;background:#fef9c3;">Des. Aceptable<br><small>(51-68)</small></th>
                <th style="text-align:center;background:#dcfce7;">Des. Óptimo<br><small>(69-85)</small></th>
                <th style="text-align:center;background:#dbeafe;">Des. Pleno<br><small>(86-100)</small></th>
                <th style="text-align:center;">Total</th>
              </tr>
            </thead>
            <tbody>
              ${filas.map(f => `
                <tr>
                  <td style="font-weight:500;">${escapeHtml(f.nombre)}</td>
                  <td style="text-align:center;background:#fff5f5;">
                    ${f.ed > 0 ? `<strong style="color:#dc2626;">${f.ed}</strong>` : '—'}
                    ${f.ed > 0 ? `<br><small style="color:#9ca3af;">${f.pED}%</small>` : ''}
                  </td>
                  <td style="text-align:center;background:#fffbeb;">
                    ${f.da > 0 ? `<strong style="color:#d97706;">${f.da}</strong>` : '—'}
                    ${f.da > 0 ? `<br><small style="color:#9ca3af;">${f.pDA}%</small>` : ''}
                  </td>
                  <td style="text-align:center;background:#f0fdf4;">
                    ${f.dopt > 0 ? `<strong style="color:#16a34a;">${f.dopt}</strong>` : '—'}
                    ${f.dopt > 0 ? `<br><small style="color:#9ca3af;">${f.pDO}%</small>` : ''}
                  </td>
                  <td style="text-align:center;background:#eff6ff;">
                    ${f.dp > 0 ? `<strong style="color:#2563eb;">${f.dp}</strong>` : '—'}
                    ${f.dp > 0 ? `<br><small style="color:#9ca3af;">${f.pDP}%</small>` : ''}
                  </td>
                  <td style="text-align:center;font-weight:600;">${f.total}</td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`
  } catch (e) {
    console.error(e)
    cont.innerHTML = _error()
  } finally {
    ocultarLoader()
  }
}

// ─── REPORTE 2: EXCELENCIA ─────────────────────────────────────
async function renderExcelencia(periodo, nivel) {
  const cont = document.getElementById('rep-contenido')
  cont.innerHTML = _loading()
  mostrarLoader('Cargando excelencia académica...')
  try {
    const notas = await _getNotas(periodo, nivel)
    if (!notas.length) { cont.innerHTML = _empty(MSG_SIN_NOTAS); return }

    // Promedio por estudiante (solo materias con nota > 0)
    const porEst = {}
    notas.forEach(r => {
      if (!porEst[r.estudiante_id]) {
        porEst[r.estudiante_id] = { nombre: r.estudiante, carnet: r.carnet, curso: r.curso, notas: [] }
      }
      if (parseFloat(r.nota_final) > 0) porEst[r.estudiante_id].notas.push(parseFloat(r.nota_final))   // exactas
    })

    const lista = Object.values(porEst)
      .map(e => ({
        ...e,
        // Oficial: promedio de notas redondeadas, redondeado. Exacto: solo para desempatar
        promedio: e.notas.length ? notaOficial(e.notas.reduce((s,n)=>s+notaOficial(n),0) / e.notas.length) : 0,
        promedioExacto: e.notas.length ? e.notas.reduce((s,n)=>s+Number(n),0) / e.notas.length : 0
      }))
      .filter(e => e.promedio >= EXCELENCIA_BASE)
      .sort((a, b) => b.promedio - a.promedio || b.promedioExacto - a.promedioExacto)   // empate: decide el decimal

    if (!lista.length) {
      cont.innerHTML = _empty('No hay estudiantes con promedio ≥ 95 en este período')
      return
    }

    cont.innerHTML = _avisoAbierto(periodo) + `
      <div class="card" style="padding:0;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;">
          <span class="card-title" style="margin:0;">🏆 Excelencia Académica</span>
          <span class="badge badge-success">${lista.length} estudiantes</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Estudiante</th>
                <th>Carnet</th>
                <th>Curso</th>
                <th style="text-align:center;">Promedio</th>
                <th style="text-align:center;">Distinción</th>
              </tr>
            </thead>
            <tbody>
              ${lista.map((e, i) => `
                <tr style="${e.promedio >= EXCELENCIA_HONOR ? 'background:#fffbeb;' : ''}">
                  <td style="font-weight:700;color:#6b7280;">${i+1}</td>
                  <td style="font-weight:600;">${escapeHtml(e.nombre)}</td>
                  <td style="font-family:monospace;font-size:12px;">${e.carnet}</td>
                  <td>${escapeHtml(e.curso)}</td>
                  <td style="text-align:center;">
                    <strong style="font-size:16px;color:${e.promedio>=EXCELENCIA_HONOR?'#b45309':'#2563eb'};">
                      <span title="${tituloExacto(e.promedioExacto)}">${e.promedio}</span>
                    </strong>
                  </td>
                  <td style="text-align:center;">
                    ${e.promedio >= EXCELENCIA_HONOR
                      ? '<span style="background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">🥇 HONOR</span>'
                      : '<span style="background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;">⭐ EXCELENCIA</span>'
                    }
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`
  } catch (e) {
    console.error(e)
    cont.innerHTML = _error()
  } finally {
    ocultarLoader()
  }
}

// ─── REPORTE 3: SEMÁFORO DE RIESGO ─────────────────────────────
// Misma regla en todo el sistema (utils/estado-notas.js):
//   trimestre abierto → En riesgo si HACER+SABER < nota mínima (falta HACER o SABER = En curso)
//   trimestre cerrado → Reprobado si nota < nota mínima
//   anual → promedio de los trimestres con notas en el sistema
async function renderSemaforo(periodo, nivel) {
  const cont = document.getElementById('rep-contenido')
  cont.innerHTML = _loading()
  mostrarLoader('Cargando semáforo de riesgo...')
  try {
    const ctx = _ctx()
    const porEst = {}
    const nuevo = r => (porEst[r.estudiante_id] ??= { nombre: r.estudiante, carnet: r.carnet, curso: r.curso, alertas: [] })
    let usadosAnual = new Set()

    if (periodo === 'anual') {
      // Trae cada trimestre y arma { est: { materia: { t: fila } } }
      const nums = (Config.periodos ?? []).map(p => p.numero)
      const lotes = await Promise.all(nums.map(t => _getNotas(t, nivel)))
      const filas = lotes.flat()
      if (!filas.length) { cont.innerHTML = _empty(MSG_SIN_NOTAS); return }
      const mat = {}
      filas.forEach(r => {
        nuevo(r)
        ;(((mat[r.estudiante_id] ??= {})[r.materia_id] ??= { nombre: r.materia, tri: {} }).tri)[r.trimestre] = r
      })
      Object.entries(mat).forEach(([estId, materias]) => {
        Object.values(materias).forEach(m => {
          const a = promedioAnual(m.tri, ctx)
          a.usados.forEach(t => usadosAnual.add(t))
          if (esAlerta(a)) porEst[estId].alertas.push({ materia: m.nombre, valor: a.promedio, clave: a.clave, detalle: a.detalle })
        })
      })
    } else {
      const notas = await _getNotas(periodo, nivel)
      if (!notas.length) { cont.innerHTML = _empty(MSG_SIN_NOTAS); return }
      notas.forEach(r => {
        const e = estadoTrimestre(r, ctx)
        const est = nuevo(r)
        if (esAlerta(e.clave)) est.alertas.push({ materia: r.materia, valor: e.clave === 'en-riesgo' && !e.completa ? e.hs : e.nota, clave: e.clave })
      })
    }

    const total = Object.keys(porEst).length
    const lista = Object.values(porEst)
      .filter(e => e.alertas.length > 0)
      .sort((a, b) => b.alertas.length - a.alertas.length || a.nombre.localeCompare(b.nombre, 'es'))

    const abierto = _abierto(periodo)
    const anual   = periodo === 'anual'
    const umbral  = ctx.notaMinima
    // Anual con gestión cerrada: si hay datos completos es Reprobado; si faltan trimestres, "bajo la nota mínima"
    const etiqueta = anual ? (ctx.bloqueada ? 'Reprobado' : 'En riesgo') : (abierto ? 'En riesgo' : 'Reprobado')
    const parcialCerrado = anual && ctx.bloqueada && Object.values(porEst).some(e => e.alertas.some(a => a.clave === 'parcial'))
    const titulo = parcialCerrado ? `con promedio bajo ${umbral} (datos parciales)` : (etiqueta === 'Reprobado' ? 'reprobados' : 'en riesgo')
    const usadosTxt = [...usadosAnual].sort().map(t => 'T' + t).join(', ')
    const criterio = anual
      ? `<strong>Anual:</strong> promedio de los trimestres con notas en el sistema${usadosTxt ? ` (en este colegio: ${usadosTxt})` : ''}.
         Un trimestre cerrado aporta su nota completa; el trimestre abierto aporta HACER+SABER.
         Aparece el estudiante cuyo promedio es menor a <strong>${umbral}</strong>.
         Un trimestre sin notas en el sistema no cuenta como cero.
         ${ctx.bloqueada ? `Gestión cerrada: si el colegio no tiene todos los trimestres en el sistema, el resultado se muestra como
         "datos parciales" y no como Aprobado/Reprobado definitivo.` : ''}`
      : abierto
        ? `<strong>${escapeHtml(_nombrePeriodo(periodo))} abierto:</strong> aparece el estudiante cuya nota de
           <strong>HACER+SABER es menor a ${umbral}</strong> en una o más materias. SER y DECIDIR se suman al cierre, salvo que ya estén calificados (entonces se juzga la nota completa).
           Si aún falta calificar HACER o SABER, la materia queda "En curso" y no se cuenta. Es el mismo criterio de "Bajo Rendimiento" del profesor.`
        : `<strong>${escapeHtml(_nombrePeriodo(periodo))} cerrado:</strong> aparece el estudiante con
           <strong>nota final menor a ${umbral}</strong> (HACER+SABER+SER+DECIDIR) en una o más materias.`

    const cajaCriterio = `<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:12px;color:#1e40af;line-height:1.6;margin-bottom:14px;">
        <strong>¿Quién aparece?</strong> ${criterio}
        <br>🔴 3 o más materias · 🟡 1 a 2 materias. El número junto a cada materia es ${anual ? 'el promedio anual' : abierto ? 'HACER+SABER' : 'la nota final'}.
      </div>`

    if (!lista.length) {
      cont.innerHTML = cajaCriterio + `
        <div class="card" style="text-align:center;padding:48px;">
          <div style="font-size:48px;margin-bottom:12px;">🟢</div>
          <div style="font-size:18px;font-weight:700;color:#16a34a;">Sin estudiantes ${titulo}</div>
          <div style="color:#6b7280;margin-top:8px;">${total} estudiantes con notas en este período</div>
        </div>`
      return
    }

    const rojos     = lista.filter(e => e.alertas.length >= 3)
    const amarillos = lista.filter(e => e.alertas.length < 3)

    cont.innerHTML = cajaCriterio + `
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;">
        <div class="stat-card" style="border-left:4px solid #ef4444;min-width:140px;">
          <div class="stat-card-label">🔴 3 o más materias</div>
          <div class="stat-card-value" style="color:#ef4444;">${rojos.length}</div>
        </div>
        <div class="stat-card" style="border-left:4px solid #f59e0b;min-width:140px;">
          <div class="stat-card-label">🟡 1 a 2 materias</div>
          <div class="stat-card-value" style="color:#f59e0b;">${amarillos.length}</div>
        </div>
        <div class="stat-card" style="min-width:140px;">
          <div class="stat-card-label">Total ${parcialCerrado ? 'bajo ' + umbral : (etiqueta === 'Reprobado' ? 'reprobados' : 'en riesgo')}</div>
          <div class="stat-card-value">${lista.length} <small style="font-size:12px;color:#6b7280;">de ${total}</small></div>
        </div>
      </div>

      <div class="card" style="padding:0;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--color-border);">
          <span class="card-title" style="margin:0;">🚦 Estudiantes ${titulo} — ${escapeHtml(_nombrePeriodo(periodo))}</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th style="width:40px;"></th>
                <th>Estudiante</th>
                <th>Curso</th>
                <th style="text-align:center;">Materias ${parcialCerrado ? 'bajo ' + umbral : (etiqueta === 'Reprobado' ? 'reprobadas' : 'en riesgo')}</th>
                <th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              ${lista.map(e => {
                const esRojo = e.alertas.length >= 3
                const semaforo = esRojo ? '🔴' : '🟡'
                const bg = esRojo ? 'background:#fff5f5;' : 'background:#fffbeb;'
                return `
                  <tr style="${bg}">
                    <td style="text-align:center;font-size:18px;">${semaforo}</td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(e.nombre)}</div>
                      <div style="font-size:11px;color:#9ca3af;font-family:monospace;">${escapeHtml(e.carnet ?? '')}</div>
                    </td>
                    <td>${escapeHtml(e.curso)}</td>
                    <td style="text-align:center;">
                      <strong style="font-size:18px;color:${esRojo?'#dc2626':'#d97706'};">${e.alertas.length}</strong>
                    </td>
                    <td>
                      <div style="display:flex;gap:4px;flex-wrap:wrap;">
                        ${e.alertas.map(m => `
                          <span title="${escapeHtml(m.detalle ?? '')}" style="background:${esRojo?'#fee2e2':'#fef9c3'};color:${esRojo?'#991b1b':'#92400e'};
                            padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">
                            ${escapeHtml(m.materia)} (${fmtNota(m.valor)}${m.clave === 'parcial' ? ' · parcial' : ''})
                          </span>`).join('')}
                      </div>
                    </td>
                  </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`
  } catch (e) {
    console.error(e)
    cont.innerHTML = _error()
  } finally {
    ocultarLoader()
  }
}

// ─── REPORTE 4: RENDIMIENTO POR MATERIA ────────────────────────
async function renderRendimiento(periodo, nivel) {
  const cont = document.getElementById('rep-contenido')
  cont.innerHTML = _loading()
  mostrarLoader('Cargando rendimiento por materia...')
  try {
    const notas = await _getNotas(periodo, nivel)
    if (!notas.length) { cont.innerHTML = _empty(MSG_SIN_NOTAS); return }

    const ctx = _ctx()
    const abierto = _abierto(periodo)
    const lblOk  = abierto ? 'En curso'  : 'Aprobados'
    const lblMal = abierto ? 'En riesgo' : 'Reprobados'

    const porMateria = {}
    notas.forEach(r => {
      if (!porMateria[r.materia_id]) {
        porMateria[r.materia_id] = { nombre: r.materia, notas: [], aprobados: 0, reprobados: 0 }
      }
      const m = porMateria[r.materia_id]
      // Incluye el 0 registrado por el profesor (la RPC ya excluye filas sin ninguna calificación)
      const e = estadoTrimestre(r, ctx)
      // Trimestre abierto: el promedio es de HACER+SABER (falta HACER o SABER: no se cuenta)
      if (abierto) { if (e.hs == null) return; m.notas.push(notaOficial(e.completa ? e.nota : e.hs)) }
      else m.notas.push(notaOficial(r.nota_final))
      if (esAlerta(e.clave)) m.reprobados++
      else m.aprobados++
    })

    const filas = Object.values(porMateria).map(m => ({
      nombre:    m.nombre,
      promedio:  m.notas.length ? parseFloat((m.notas.reduce((s,n)=>s+n,0)/m.notas.length).toFixed(2)) : 0,
      total:     m.aprobados + m.reprobados,
      aprobados: m.aprobados,
      reprobados: m.reprobados,
      pct:       m.aprobados + m.reprobados > 0
        ? parseFloat(((m.aprobados / (m.aprobados + m.reprobados)) * 100).toFixed(1))
        : 0
    })).sort((a, b) => a.pct - b.pct) // peor rendimiento primero

    cont.innerHTML = _avisoAbierto(periodo) + `
      <div class="card" style="padding:0;">
        <div style="padding:16px 20px;border-bottom:1px solid var(--color-border);">
          <span class="card-title" style="margin:0;">📚 Rendimiento por Materia</span>
          <span style="font-size:12px;color:#6b7280;margin-left:12px;">${abierto ? 'Trimestre abierto: promedio y riesgo según HACER+SABER' : 'Ordenado de menor a mayor aprobación'}</span>
        </div>
        <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Materia</th>
                <th style="text-align:center;">Promedio</th>
                <th style="text-align:center;">${lblOk}</th>
                <th style="text-align:center;">${lblMal}</th>
                <th style="text-align:center;">Total</th>
                <th style="min-width:140px;">% ${abierto ? 'En curso' : 'Aprobación'}</th>
              </tr>
            </thead>
            <tbody>
              ${filas.map(f => {
                const color = f.pct >= 80 ? '#16a34a' : f.pct >= 51 ? '#d97706' : '#dc2626'
                return `
                  <tr>
                    <td style="font-weight:500;">${escapeHtml(f.nombre)}</td>
                    <td style="text-align:center;font-weight:700;" title="${tituloExacto(f.promedio)}">${fmtNota(f.promedio)}</td>
                    <td style="text-align:center;color:#16a34a;font-weight:600;">${f.aprobados}</td>
                    <td style="text-align:center;color:#dc2626;font-weight:600;">${f.reprobados}</td>
                    <td style="text-align:center;color:#6b7280;">${f.total}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px;">
                        <div style="flex:1;background:#e5e7eb;border-radius:4px;height:8px;">
                          <div style="width:${f.pct}%;background:${color};height:8px;border-radius:4px;transition:width .4s;"></div>
                        </div>
                        <span style="font-weight:700;color:${color};min-width:40px;">${f.pct}%</span>
                      </div>
                    </td>
                  </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>`
  } catch (e) {
    console.error(e)
    cont.innerHTML = _error()
  } finally {
    ocultarLoader()
  }
}

// ─── EXPORTAR EXCEL FORMATO MINISTERIO ─────────────────────────
export async function exportarAprovechamientoExcel() {
  const { periodo, nivel } = _getFiltros()
  mostrarLoader('Generando Excel...')
  try {
    if (periodo === 'anual') { toast('El Excel de aprovechamiento es por trimestre. Elige un trimestre.', 'warning'); return }
    const notas = await _getNotas(periodo, nivel)
    if (!notas.length) { toast(MSG_SIN_NOTAS, 'warning'); return }

    const wb = XLSX.utils.book_new()
    const nombrePeriodo = Config.periodos?.find(p => p.numero === periodo)?.nombre ?? `Trimestre ${periodo}`
    const año = Config.año

    // Cabecera del colegio
    const cabecera = [
      [null, 'Informe de Aprovechamiento Trimestral'],
      [null, 'Distrito Escolar:', null, null, 'Unidad Educativa:', null, null, window.APP_CONFIG?.nombre_colegio ?? ''],
      [null, 'Localidad:', null, null, null, null, null, null, 'TRIMESTRE', null, nombrePeriodo],
      [null, 'DIRECTOR', null, null, null, null, null, null, null, null, 'Gestión', null, año],
      [null, 'Nº', 'CAMPOS', 'ÁREA CURRICULAR', 'APROVECHAMIENTO', null, null, null, null, null, null, null, 'Total Estudiantes', '%'],
      [null, null, null, null, 'En Desarrollo', null, 'Desarrollo Aceptable', null, 'Desarrollo Óptimo', null, 'Desarrollo Pleno', null, null, null],
      [null, null, null, null, '(1 - 50)', '%', '(51 - 68)', '%', '(69 - 85)', '%', '(86 - 100)', '%', null, null],
    ]

    // Datos por nivel
    const niveles = nivel ? [nivel] : ['Primaria', 'Secundaria']
    const sheetNames = {
      'Primaria':    'PRIMARIA',
      'Secundaria':  'SECUNDARIA'
    }

    niveles.forEach(niv => {
      const notasNivel = notas.filter(r => r.nivel === niv)
      const porMateria = {}
      notasNivel.forEach(r => {
        if (!porMateria[r.materia_id]) porMateria[r.materia_id] = { nombre: r.materia, notas: [] }
        // El 0 registrado cuenta en "En desarrollo (1-50)"
        if (Number(r.nota_final) >= 0) porMateria[r.materia_id].notas.push(notaOficial(r.nota_final))
      })

      const filas = Object.values(porMateria).map((m, i) => {
        const ns = m.notas; const total = ns.length
        // Mismos cortes que la pantalla (nota < 51 = En desarrollo)
        const ed = ns.filter(n=>n<51).length
        const da = ns.filter(n=>n>=51&&n<69).length
        const do_ = ns.filter(n=>n>=69&&n<86).length
        const dp = ns.filter(n=>n>=86).length
        return [
          null, i+1, null, m.nombre,
          ed || null, total ? parseFloat(((ed/total)*100).toFixed(1)) : null,
          da || null, total ? parseFloat(((da/total)*100).toFixed(1)) : null,
          do_ || null, total ? parseFloat(((do_/total)*100).toFixed(1)) : null,
          dp || null, total ? parseFloat(((dp/total)*100).toFixed(1)) : null,
          total, total ? 100 : null
        ]
      })

      const totalEst = new Set(notasNivel.map(r=>r.estudiante_id)).size
      const totales = [null, null, null, null, 'Total General', null, null, null, null, null, null, null, totalEst, null]

      const wsData = [...cabecera, ...filas, totales]
      const ws = XLSX.utils.aoa_to_sheet(wsData)
      ws['!cols'] = [5,5,22,30,12,8,12,8,12,8,12,8,12,8].map(w=>({wch:w}))
      XLSX.utils.book_append_sheet(wb, ws, sheetNames[niv] ?? niv)
    })

    // Hoja por cursos
    const cursoNiveles = nivel ? [nivel] : ['Primaria', 'Secundaria']
    cursoNiveles.forEach(niv => {
      const notasNivel = notas.filter(r => r.nivel === niv)
      const porCurso = {}
      notasNivel.forEach(r => {
        if (!porCurso[r.curso_id]) porCurso[r.curso_id] = { nombre: r.curso, notas: [], aprobados: 0, total: 0 }
        if (Number(r.nota_final) >= 0) {
          porCurso[r.curso_id].notas.push(notaOficial(r.nota_final))
          porCurso[r.curso_id].total++
          if (!esAlerta(estadoTrimestre(r, _ctx()).clave)) porCurso[r.curso_id].aprobados++
        }
      })

      const cabeceraC = [
        [null, `Informe de Aprovechamiento Trimestral\nNivel ${niv}`],
        [null, 'Distrito Escolar:', null, null, 'Unidad Educativa:', null, null, window.APP_CONFIG?.nombre_colegio ?? ''],
        [null, 'Localidad:', null, null, null, null, null, null, 'TRIMESTRE', null, nombrePeriodo],
        [null, 'DIRECTOR', null, null, null, null, null, null, null, null, 'Gestión', año],
        [null, 'Nº', 'CURSOS', 'PARALELOS', 'APROVECHAMIENTO', null, null, null, null, null, null, null, 'Total Estudiantes', '%'],
        [null, null, null, null, 'En Desarrollo', null, 'Des. Aceptable', null, 'Des. Óptimo', null, 'Des. Pleno', null, null, null],
        [null, null, null, null, '(1-50)', '%', '(51-68)', '%', '(69-85)', '%', '(86-100)', '%', null, null],
      ]

      const filasCurso = Object.values(porCurso).map((c, i) => {
        const ns = c.notas; const total = ns.length
        // Mismos cortes que la pantalla (nota < 51 = En desarrollo)
        const ed = ns.filter(n=>n<51).length
        const da = ns.filter(n=>n>=51&&n<69).length
        const do_ = ns.filter(n=>n>=69&&n<86).length
        const dp = ns.filter(n=>n>=86).length
        const parts = c.nombre.split(' ')
        return [
          null, i+1, parts.slice(0,-1).join(' '), parts.slice(-1)[0],
          ed||null, total?parseFloat(((ed/total)*100).toFixed(1)):null,
          da||null, total?parseFloat(((da/total)*100).toFixed(1)):null,
          do_||null, total?parseFloat(((do_/total)*100).toFixed(1)):null,
          dp||null, total?parseFloat(((dp/total)*100).toFixed(1)):null,
          total, null
        ]
      })

      const wsC = XLSX.utils.aoa_to_sheet([...cabeceraC, ...filasCurso])
      wsC['!cols'] = [5,5,20,12,10,7,10,7,10,7,10,7,12,8].map(w=>({wch:w}))
      XLSX.utils.book_append_sheet(wb, wsC, `CURSOS ${niv.toUpperCase()}`)
    })

    const nombreArchivo = `Aprovechamiento_${nombrePeriodo.replace(' ','_')}_${año}.xlsx`
    XLSX.writeFile(wb, nombreArchivo)
    toast('Excel generado correctamente', 'success')
  } catch (e) {
    console.error(e)
    toast('No se pudo generar el Excel', 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── HELPERS UI ────────────────────────────────────────────────
function _avisoAbierto(periodo) {
  if (!_abierto(periodo)) return ''
  return `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:12px;color:#92400e;margin-bottom:12px;">
    <strong>${escapeHtml(_nombrePeriodo(periodo))} abierto:</strong> las notas son parciales (pueden faltar actividades, SER y DECIDIR).
    El resultado definitivo se ve al cerrar el trimestre. Para identificar estudiantes en riesgo usa el <strong>Semáforo de Riesgo</strong>.
  </div>`
}
function _loading() {
  return `<div class="empty-state"><div class="empty-state-icon">⏳</div><div class="empty-state-title">Cargando...</div></div>`
}
function _empty(msg) {
  return `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-title">${msg}</div></div>`
}
function _error() {
  return `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">Error al cargar datos</div></div>`
}
function _pct(n, total) {
  return total > 0 ? parseFloat(((n/total)*100).toFixed(1)) : 0
}