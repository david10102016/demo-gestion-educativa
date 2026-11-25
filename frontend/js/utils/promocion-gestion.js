// frontend/js/utils/promocion-gestion.js
//
// Pantalla de revisión de promoción de estudiantes al cerrar gestión.
// Fase 2 de la migración 062 -- consume el mecanismo ya aplicado en
// Fase 1 (columna estudiantes.estado + funciones promover_estudiante /
// marcar_egresado), sin duplicar ningún cálculo propio: la decisión
// aprobado/reprobado sale de calcularPromedioAnualLote(), la misma
// función que ya usa el botón "Promedio Anual" -- así nunca puede
// mostrar algo distinto de lo que el director ya ve en esa pantalla.
//
// Regla de negocio (confirmada): todas las materias aprobadas = pasa
// de curso. Una o más reprobadas = repite el año completo. Sin
// promedio de una o más materias todavía (trimestre pendiente) =
// queda "pendiente", no se decide a medias.
//
// Se inyecta como modal propio (mismo patrón que
// informe-junta-trimestral.js) -- no requiere sección estática nueva
// en dashboard-director.html, solo el botón que lo abre.

import { supabase } from '../config/supabase-config.js'
import { calcularPromedioAnualLote } from './promedio-anual.js'
import { escapeHtml } from './sanitize.js'
import { Config } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader } from './ui.js'

let _colegioId = null
let _grupos = []      // [{ curso, estudiantes: [...] }]
let _cambiosManuales = {} // estudianteId -> curso_destino_id | 'repite' | 'egresa' | null

// ── Punto de entrada ──
export async function abrirPromocionGestion(colegioId) {
  if (!colegioId) {
    toast('No se pudo determinar el colegio de la sesión', 'error')
    return
  }
  _colegioId = colegioId
  _cambiosManuales = {}

  mostrarLoader('Calculando promoción...')
  try {
    await _cargarDatos()
  } catch (err) {
    console.error('Error cargando promoción:', err)
    toast('Error al calcular la promoción: ' + err.message, 'error')
    ocultarLoader()
    return
  }
  ocultarLoader()
  _render()
}

// Materias que le corresponde tener calificadas a un estudiante, según
// su nivel/grado -- mismo criterio que ya usa generar-libreta-pdf.js
// (canje de "Técnica Tecnológica General" desde 4to Secundaria) más su
// inscripción técnica real si tiene una activa. Se usa para detectar
// una materia con CERO notas en todo el año, que calcularPromedioAnualLote
// no reporta como "incompleta" -- directamente no aparece en su resultado.
async function _materiasEsperadasPorCurso(curso, materiasDelNivelCache) {
  const nivel = curso.nivel
  const gradoNum = curso.grado

  if (!materiasDelNivelCache[nivel]) {
    const { data } = await supabase
      .from('materias')
      .select('id, nombre, es_tecnica')
      .eq('nivel', nivel)
      .eq('activo', true)
    materiasDelNivelCache[nivel] = data ?? []
  }
  const todas = materiasDelNivelCache[nivel]
  let regulares = todas.filter(m => !m.es_tecnica)

  if (nivel === 'Secundaria' && gradoNum >= 4) {
    regulares = regulares.filter(m => m.nombre !== 'Técnica Tecnológica General')
  }

  return regulares.map(m => m.id)
}

// ── Carga y cálculo ──
async function _cargarDatos() {
  // 1. Cursos activos del colegio
  const { data: cursos, error: errCursos } = await supabase
    .from('cursos')
    .select('id, nivel, grado, paralelo, nombre_completo, colegio_id, activo')
    .eq('colegio_id', _colegioId)
    .eq('activo', true)
    .order('nivel').order('grado').order('paralelo')
  if (errCursos) throw errCursos

  const cursosPorId = Object.fromEntries((cursos ?? []).map(c => [c.id, c]))

  // 2. Estudiantes activos del colegio, agrupados por curso
  const { data: estudiantes, error: errEst } = await supabase
    .from('estudiantes')
    .select('id, carnet, curso_id, colegio_id, estado, usuarios!inner(nombre_completo)')
    .eq('colegio_id', _colegioId)
    .eq('estado', 'activo')
    .not('curso_id', 'is', null)
  if (errEst) throw errEst

  if (!estudiantes?.length) {
    _grupos = []
    return
  }

  // 3. Inscripciones técnicas activas de estos estudiantes -- para saber
  //    quién tiene una carrera técnica real y cuál (bug 1: sin esto, una
  //    materia técnica sin ninguna nota queda totalmente invisible).
  const estudianteIds = estudiantes.map(e => e.id)
  const { data: inscripciones } = await supabase
    .from('inscripciones_tecnicas')
    .select('estudiante_id, materia_id')
    .in('estudiante_id', estudianteIds)
    .eq('activo', true)

  const tecnicaPorEstudiante = {}
  ;(inscripciones ?? []).forEach(i => { tecnicaPorEstudiante[i.estudiante_id] = i.materia_id })

  // 4. Materias relevantes SOLO (regulares del nivel + técnicas con
  //    inscripción real) -- evita que notas_finales traiga de vuelta
  //    TODAS las materias técnicas que existen en el colegio, incluidas
  //    las que nadie de este lote cursa. Eso era lo que hacía superar
  //    las 1000 filas que Supabase corta por defecto, aún en un
  //    colegio de 58 estudiantes.
  const materiasDelNivelCache = {}
  const nivelesUsados = [...new Set(cursos.map(c => c.nivel))]
  for (const nivel of nivelesUsados) {
    const { data } = await supabase
      .from('materias')
      .select('id, nombre, es_tecnica')
      .eq('nivel', nivel)
      .eq('activo', true)
    materiasDelNivelCache[nivel] = data ?? []
  }
  const regularesTodos = Object.values(materiasDelNivelCache).flat().filter(m => !m.es_tecnica).map(m => m.id)
  const tecnicasUsadas = [...new Set(Object.values(tecnicaPorEstudiante))]
  const materiaIdsRelevantes = [...new Set([...regularesTodos, ...tecnicasUsadas])]

  // 5. Promedio anual en lote -- misma función que "Promedio Anual",
  //    ahora acotado a lo que realmente corresponde
  const promedios = await calcularPromedioAnualLote(estudianteIds, materiaIdsRelevantes)

  // 6. Resultado por estudiante: aprobado / reprobado / pendiente
  const resultados = {}

  for (const est of estudiantes) {
    const curso = cursosPorId[est.curso_id]
    if (!curso) continue

    const materiasCalificadas = promedios[est.id] ?? []
    const materiasCalifPorId = Object.fromEntries(materiasCalificadas.map(m => [m.materia_id, m]))

    // Lista de materias que le corresponden (regulares con el canje ya
    // aplicado, más su técnica si tiene inscripción activa)
    const esperadasRegulares = await _materiasEsperadasPorCurso(curso, materiasDelNivelCache)
    const idsEsperados = [...esperadasRegulares]
    if (tecnicaPorEstudiante[est.id]) idsEsperados.push(tecnicaPorEstudiante[est.id])

    const faltantes = idsEsperados.filter(id => !materiasCalifPorId[id])
    const incompletas = materiasCalificadas.filter(m => !m.completo && idsEsperados.includes(m.materia_id))

    if (faltantes.length || incompletas.length) {
      const partes = []
      if (faltantes.length) partes.push(`${faltantes.length} materia(s) sin ninguna nota registrada`)
      if (incompletas.length) partes.push(`${incompletas.length} materia(s) sin cerrar (falta trimestre)`)
      resultados[est.id] = { resultado: 'pendiente', motivo: partes.join(' + ') }
      continue
    }

    // Comparación numérica directa contra la nota mínima real del
    // colegio -- nunca por texto de etiqueta_reprobado (personalizable
    // por colegio, no confiable para decidir).
    const algunaReprobada = materiasCalificadas.some(m => m.promedio < Config.notaMinima)
    resultados[est.id] = algunaReprobada
      ? { resultado: 'reprobado', motivo: null }
      : { resultado: 'aprobado', motivo: null }
  }

  // 6. Curso destino sugerido para cada aprobado
  const grupos = {}
  for (const est of estudiantes) {
    const cursoActual = cursosPorId[est.curso_id]
    if (!cursoActual) continue
    const key = cursoActual.id
    if (!grupos[key]) grupos[key] = { curso: cursoActual, estudiantes: [] }

    const r = resultados[est.id]
    let destino = null
    let estadoFinal = r.resultado

    if (r.resultado === 'aprobado') {
      const sugerido = _calcularCursoDestino(cursoActual, cursos)
      if (sugerido === 'egresa') {
        estadoFinal = 'egresa'
      } else if (sugerido) {
        destino = sugerido
      } else {
        estadoFinal = 'pendiente'
        r.motivo = 'No existe curso destino (revisar paralelo/grado)'
      }
    }

    grupos[key].estudiantes.push({
      id: est.id,
      nombre: est.usuarios?.nombre_completo ?? 'Sin nombre',
      carnet: est.carnet,
      resultado: estadoFinal,
      motivo: r.motivo,
      cursoDestinoId: destino?.id ?? null,
      cursoDestinoNombre: destino?.nombre_completo ?? null
    })
  }

  _grupos = Object.values(grupos).sort((a, b) =>
    a.curso.nombre_completo.localeCompare(b.curso.nombre_completo)
  )
}

// Primaria grado 6 -> Secundaria grado 1. Secundaria grado 6 -> egresa.
// En cualquier otro caso: mismo nivel, grado + 1, mismo paralelo.
function _calcularCursoDestino(cursoActual, todosCursos) {
  const { nivel, grado, paralelo } = cursoActual

  if (nivel === 'Secundaria' && grado === 6) return 'egresa'

  const nivelDestino = (nivel === 'Primaria' && grado === 6) ? 'Secundaria' : nivel
  const gradoDestino = (nivel === 'Primaria' && grado === 6) ? 1 : grado + 1

  return todosCursos.find(c =>
    c.nivel === nivelDestino && c.grado === gradoDestino && c.paralelo === paralelo
  ) ?? null
}

// ── Render del modal ──
function _render() {
  document.getElementById('promocion-modal')?.remove()

  const totalAprobados = _grupos.flatMap(g => g.estudiantes).filter(e => e.resultado === 'aprobado').length
  const totalReprobados = _grupos.flatMap(g => g.estudiantes).filter(e => e.resultado === 'reprobado').length
  const totalEgresa = _grupos.flatMap(g => g.estudiantes).filter(e => e.resultado === 'egresa').length
  const totalPendientes = _grupos.flatMap(g => g.estudiantes).filter(e => e.resultado === 'pendiente').length

  const m = document.createElement('div')
  m.id = 'promocion-modal'
  m.style.cssText = `
    position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9999;
    display:flex;align-items:flex-start;justify-content:center;padding:24px;overflow-y:auto;
  `
  m.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:920px;width:100%;padding:24px;margin-top:24px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
        <h2 style="margin:0;font-size:20px;">Revisión de promoción de estudiantes</h2>
        <button id="promocion-btn-cerrar" style="border:none;background:none;font-size:20px;cursor:pointer;">✕</button>
      </div>
      <p style="color:#6b7280;font-size:13px;margin-top:0;">
        Revisá la lista antes de confirmar. No se mueve ningún estudiante hasta que apretés "Confirmar y continuar".
      </p>

      <div style="display:flex;gap:10px;margin:16px 0;flex-wrap:wrap;">
        <div style="background:#d1fae5;color:#065f46;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">✓ ${totalAprobados} pasan de curso</div>
        <div style="background:#fee2e2;color:#991b1b;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">↻ ${totalReprobados} repiten</div>
        <div style="background:#dbeafe;color:#1e40af;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">🎓 ${totalEgresa} egresan</div>
        ${totalPendientes ? `<div style="background:#fef3c7;color:#92400e;padding:6px 12px;border-radius:8px;font-size:13px;font-weight:600;">⚠ ${totalPendientes} pendientes</div>` : ''}
      </div>

      <div id="promocion-grupos"></div>

      <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;border-top:1px solid #e5e7eb;padding-top:16px;">
        <button id="promocion-btn-cancelar" class="btn" style="padding:10px 16px;border-radius:10px;border:1px solid #d1d5db;background:#fff;cursor:pointer;">Cancelar</button>
        <button id="promocion-btn-confirmar" class="btn" style="padding:10px 16px;border-radius:10px;border:none;background:#4f46e5;color:#fff;font-weight:600;cursor:pointer;">
          Confirmar y continuar
        </button>
      </div>
    </div>
  `
  document.body.appendChild(m)

  const cont = document.getElementById('promocion-grupos')
  cont.innerHTML = _grupos.map(g => `
    <div style="margin-bottom:18px;">
      <h3 style="font-size:14px;font-weight:700;margin-bottom:8px;">${escapeHtml(g.curso.nombre_completo)}</h3>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        ${g.estudiantes.map(e => _renderFilaEstudiante(e)).join('')}
      </div>
    </div>
  `).join('') || `<p style="text-align:center;color:#6b7280;padding:32px;">No hay estudiantes activos para promover.</p>`

  document.getElementById('promocion-btn-cerrar').onclick = () => m.remove()
  document.getElementById('promocion-btn-cancelar').onclick = () => m.remove()
  document.getElementById('promocion-btn-confirmar').onclick = _confirmar

  cont.querySelectorAll('select[data-estudiante]').forEach(sel => {
    sel.onchange = () => {
      _cambiosManuales[sel.dataset.estudiante] = sel.value
    }
  })
}

function _renderFilaEstudiante(e) {
  const estilos = {
    aprobado:  { bg: '#f0fdf4', badge: '#d1fae5', color: '#065f46', label: 'Pasa' },
    reprobado: { bg: '#fef2f2', badge: '#fee2e2', color: '#991b1b', label: 'Repite' },
    egresa:    { bg: '#eff6ff', badge: '#dbeafe', color: '#1e40af', label: 'Egresa' },
    pendiente: { bg: '#fffbeb', badge: '#fef3c7', color: '#92400e', label: 'Pendiente' }
  }
  const s = estilos[e.resultado]
  const destinoTexto = e.resultado === 'aprobado'
    ? (e.cursoDestinoNombre ?? '—')
    : e.resultado === 'egresa' ? 'Egresado'
    : e.resultado === 'reprobado' ? 'Mismo curso'
    : (e.motivo ?? 'Requiere revisión manual')

  return `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:${s.bg};border-bottom:1px solid #e5e7eb;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:600;">${escapeHtml(e.nombre)}</div>
        <div style="font-size:11px;color:#6b7280;">Carnet: ${escapeHtml(e.carnet)} · ${escapeHtml(destinoTexto)}</div>
      </div>
      <span style="background:${s.badge};color:${s.color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;white-space:nowrap;">${s.label}</span>
    </div>
  `
}

// ── Confirmar: ejecuta promover_estudiante / marcar_egresado ──
async function _confirmar() {
  const pendientes = _grupos.flatMap(g => g.estudiantes).filter(e => e.resultado === 'pendiente')
  if (pendientes.length) {
    const seguro = confirm(`Hay ${pendientes.length} estudiante(s) pendiente(s) sin resolver, que no se van a mover. ¿Continuar igual?`)
    if (!seguro) return
  }

  mostrarLoader('Aplicando promoción...')
  let ok = 0, fallos = 0

  for (const g of _grupos) {
    for (const e of g.estudiantes) {
      try {
        if (e.resultado === 'aprobado' && e.cursoDestinoId) {
          const { data, error } = await supabase.rpc('promover_estudiante', {
            p_estudiante_id: e.id,
            p_curso_destino_id: e.cursoDestinoId
          })
          if (error || !data?.ok) throw new Error(data?.error ?? error?.message)
          ok++
        } else if (e.resultado === 'egresa') {
          const { data, error } = await supabase.rpc('marcar_egresado', { p_estudiante_id: e.id })
          if (error || !data?.ok) throw new Error(data?.error ?? error?.message)
          ok++
        }
        // reprobado y pendiente: no se toca, se queda como está
      } catch (err) {
        console.error(`Error promoviendo a ${e.nombre}:`, err)
        fallos++
      }
    }
  }

  ocultarLoader()
  document.getElementById('promocion-modal')?.remove()

  if (fallos) {
    toast(`Promoción aplicada con errores: ${ok} correctos, ${fallos} fallaron. Revisa la consola.`, 'warning')
  } else {
    toast(`Promoción aplicada: ${ok} estudiante(s) movidos correctamente.`, 'success')
  }

  // Avisa a quien llamó (gestion-cierre.js) que ya puede continuar
  document.dispatchEvent(new CustomEvent('promocion-completada', { detail: { ok, fallos } }))
}