// js/utils/estado-notas.js
// Lógica PURA (sin acceso a datos ni DOM) del estado de las notas.
// Es la ÚNICA regla que usan: Bajo Rendimiento y Junta (profesor), panel del
// asesor de curso y reportes del director. Así los tres roles ven lo mismo.
//
// Regla de estados (por materia y trimestre):
//   · Sin notas en el sistema  → "Sin notas". Nunca cuenta como cero.
//   · Trimestre ABIERTO:
//       - Falta HACER o SABER (sin ninguna nota)     → "En curso" (aún no se puede juzgar)
//       - HACER + SABER < nota mínima (51)            → "En riesgo"
//       - HACER + SABER ≥ nota mínima                 → "En curso"
//     SER y DECIDIR no se consideran mientras el trimestre está abierto...
//       - ...SALVO que las 4 dimensiones ya estén calificadas (HACER, SABER, SER y DECIDIR):
//         la nota ya es completa → se muestra y se juzga la NOTA FINAL (texto "Completa";
//         < nota mínima → "En riesgo").
//   · Trimestre CERRADO (gestión bloqueada o trimestre anterior al activo):
//       nota completa ≥ 51 → Aprobado · < 51 → Reprobado.
//
// Anual:
//   · Se promedian SOLO los trimestres que tienen notas en el sistema
//     (un trimestre sin notas no cuenta como cero) y se informa cuáles se usaron.
//     Trimestre cerrado aporta su nota completa; trimestre abierto aporta HACER+SABER
//     (si aún falta HACER o SABER, ese trimestre no se usa todavía). Si las 4 dimensiones
//     ya están calificadas, el trimestre abierto aporta su nota final.
//   · Gestión abierta  → "En riesgo" (promedio < 51) o "En curso".
//   · Gestión cerrada  → Aprobado / Reprobado solo si están TODOS los trimestres;
//     si faltan trimestres en el sistema → "Datos parciales (k de N)".
//
// Filas que acepta (asesor_notas_curso / reporte_notas_periodo, migración 088):
//   { estudiante_id, materia_id, materia, trimestre, nota_final, nota_hacer, nota_saber, ... }
// nota_hacer / nota_saber = null significa "esa dimensión no tiene ninguna nota".
// SER / DECIDIR calificados se leen de ser_calificado / decidir_calificado (filas normalizadas)
// o de ser_estado / decidir_estado = 'calificada' (filas crudas de las RPC, migración 110).

// ─── REDONDEO OFICIAL (único para todo el sistema) ───────────
// La base guarda decimales (integridad). Todo lo que se MUESTRA y todo lo que DECIDE
// (Aprobado/Reprobado, En riesgo, rangos del Ministerio) usa la nota redondeada:
// al entero más cercano, .5 sube (50.4 → 50 · 50.5 → 51).
// El decimal se conserva para desempatar (mejor alumno) y se ve al pasar el mouse.
export function notaOficial(n) {
  if (n === null || n === undefined || n === '') return null
  const v = Number(n)
  if (!Number.isFinite(v)) return null
  return Math.round(Math.round(v * 100) / 100)   // evita errores de coma flotante (50.4999…)
}
/** Texto para mostrar una nota: entero o '—'. */
export function fmtNota(n) {
  const o = notaOficial(n)
  return o === null ? '—' : String(o)
}
/** Texto del tooltip con la nota exacta. */
export function tituloExacto(n) {
  return n === null || n === undefined || n === '' ? '' : `Nota exacta: ${Number(n).toFixed(2)}`
}

export const NOMBRES_DIM = { hacer: 'Hacer', saber: 'Saber', ser: 'Ser', decidir: 'Decidir' }

/** Textos únicos para todas las vistas. */
export const TEXTOS = {
  'sin-calificar': 'Sin notas',
  'en-curso':      'En curso',
  'completa':      'Completa',
  'en-riesgo':     'En riesgo',
  'parcial':       'Datos parciales',
}

/** ctx = { trimestreActivo, bloqueada, notaMinima, etiqAprobado, etiqReprobado, numPeriodos } */
export function trimestreCerrado(trimestre, ctx) {
  return !!ctx.bloqueada || Number(trimestre) < Number(ctx.trimestreActivo)
}

/** Dimensiones sin ninguna calificación en esa fila (si la fila trae los estados). */
export function dimensionesPendientes(fila) {
  const p = []
  if (!fila.hacer_calificado) p.push(NOMBRES_DIM.hacer)
  if (!fila.saber_calificado) p.push(NOMBRES_DIM.saber)
  if (!fila.ser_calificado) p.push(NOMBRES_DIM.ser)
  if (!fila.decidir_calificado) p.push(NOMBRES_DIM.decidir)
  return p
}

const _dimOk = (fila, dim) => fila?.[`${dim}_calificado`] === true || fila?.[`${dim}_estado`] === 'calificada'

const _num = v => (v === null || v === undefined || v === '' ? null : Number(v))

/**
 * HACER + SABER de una fila.
 * Devuelve { hs, falta } — hs = null si falta HACER o SABER (falta = 'Hacer' | 'Saber' | 'Hacer y Saber').
 */
export function hacerSaber(fila) {
  const h = _num(fila?.nota_hacer), s = _num(fila?.nota_saber)
  if (h === null || s === null) {
    const falta = h === null && s === null ? 'Hacer y Saber' : h === null ? 'Hacer' : 'Saber'
    return { hs: null, falta }
  }
  return { hs: Math.round((h + s) * 100) / 100, falta: null }
}

/**
 * ¿La nota del trimestre ya es completa? HACER, SABER, SER y DECIDIR con calificación.
 * Solo así la nota_final de un trimestre ABIERTO es la nota real y no un avance.
 */
export function trimestreCompleto(fila) {
  return fila?.nota_final != null && hacerSaber(fila).hs !== null && _dimOk(fila, 'ser') && _dimOk(fila, 'decidir')
}

/**
 * Estado de una materia en un trimestre.
 * clave: 'sin-calificar' | 'en-curso' | 'en-riesgo' | 'aprobado' | 'reprobado'
 */
export function estadoTrimestre(fila, ctx) {
  if (!fila || fila.nota_final == null) {
    return { clave: 'sin-calificar', texto: TEXTOS['sin-calificar'], nota: null, hs: null, falta: null, completa: false,
             pendientes: dimensionesPendientes(fila ?? {}), posibles: Number(fila?.puntos_posibles ?? 0) }
  }
  const nota = Number(fila.nota_final)
  const { hs, falta } = hacerSaber(fila)
  const completa = trimestreCompleto(fila)
  const base = { nota, hs, falta, completa, pendientes: dimensionesPendientes(fila), posibles: Number(fila.puntos_posibles ?? 0) }

  if (!trimestreCerrado(fila.trimestre, ctx)) {
    if (completa) {
      // Las 4 dimensiones calificadas: la nota final es la real
      return notaOficial(nota) < ctx.notaMinima
        ? { ...base, clave: 'en-riesgo', texto: TEXTOS['en-riesgo'] }
        : { ...base, clave: 'en-curso',  texto: TEXTOS.completa }
    }
    if (hs === null) return { ...base, clave: 'en-curso', texto: `${TEXTOS['en-curso']} (falta ${falta})` }
    return notaOficial(hs) < ctx.notaMinima
      ? { ...base, clave: 'en-riesgo', texto: TEXTOS['en-riesgo'] }
      : { ...base, clave: 'en-curso',  texto: TEXTOS['en-curso'] }
  }
  return notaOficial(nota) >= ctx.notaMinima
    ? { ...base, clave: 'aprobado',  texto: ctx.etiqAprobado  ?? 'APROBADO' }
    : { ...base, clave: 'reprobado', texto: ctx.etiqReprobado ?? 'REPROBADO' }
}

/** Valor EXACTO con el que un trimestre entra al anual (null = no se usa todavía). */
function _valorAnual(fila, ctx) {
  if (!fila || fila.nota_final == null) return null
  if (trimestreCerrado(fila.trimestre, ctx)) return Number(fila.nota_final)
  return trimestreCompleto(fila) ? Number(fila.nota_final) : hacerSaber(fila).hs
}

/**
 * Resultado anual de una materia a partir de sus filas por trimestre { 1: fila, 2: fila, 3: fila }.
 * Devuelve { clave, texto, promedio, usados: [números de trimestre], detalle }.
 */
export function promedioAnual(filasPorTrimestre, ctx) {
  const usados = [], valores = [], exactos = []
  let hayNotas = false
  for (const [t, f] of Object.entries(filasPorTrimestre ?? {}).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (f && f.nota_final != null) hayNotas = true
    const v = _valorAnual(f, ctx)
    // Cada trimestre entra REDONDEADO (como en la libreta); el exacto se guarda para desempates
    if (v !== null) { usados.push(Number(t)); valores.push(notaOficial(v)); exactos.push(v) }
  }
  if (!valores.length) {
    return hayNotas
      ? { clave: 'en-curso', texto: TEXTOS['en-curso'], promedio: null, usados, detalle: 'Aún falta Hacer o Saber' }
      : { clave: 'sin-calificar', texto: TEXTOS['sin-calificar'], promedio: null, usados, detalle: '' }
  }
  // Promedio de los trimestres redondeados → redondeado (nota oficial anual)
  const promedio = notaOficial(valores.reduce((s, v) => s + v, 0) / valores.length)
  const promedioExacto = Math.round((exactos.reduce((s, v) => s + v, 0) / exactos.length) * 100) / 100
  const N = Number(ctx.numPeriodos ?? 3)
  const detalle = `Con T${usados.join(', T')}` + (usados.length < N ? ` (${usados.length} de ${N})` : '')

  if (!ctx.bloqueada) {
    return promedio < ctx.notaMinima
      ? { clave: 'en-riesgo', texto: TEXTOS['en-riesgo'], promedio, promedioExacto, usados, detalle }
      : { clave: 'en-curso',  texto: TEXTOS['en-curso'],  promedio, promedioExacto, usados, detalle }
  }
  if (usados.length < N) {
    // Faltan trimestres en el sistema: no se afirma Aprobado/Reprobado, pero se avisa si está bajo la nota mínima
    const bajo = promedio < ctx.notaMinima
    return { clave: 'parcial', bajo, texto: `${bajo ? `Bajo ${ctx.notaMinima} · ` : ''}${TEXTOS.parcial} (${usados.length} de ${N})`, promedio, promedioExacto, usados, detalle }
  }
  return promedio >= ctx.notaMinima
    ? { clave: 'aprobado',  texto: ctx.etiqAprobado  ?? 'APROBADO',  promedio, promedioExacto, usados, detalle }
    : { clave: 'reprobado', texto: ctx.etiqReprobado ?? 'REPROBADO', promedio, promedioExacto, usados, detalle }
}

/**
 * ¿Requiere atención? Acepta la clave o el resultado completo de estadoTrimestre/promedioAnual.
 * En riesgo, Reprobado, o anual con datos parciales y promedio bajo la nota mínima.
 */
export function esAlerta(r) {
  const clave = typeof r === 'string' ? r : r?.clave
  return clave === 'en-riesgo' || clave === 'reprobado' || (clave === 'parcial' && !!r?.bajo)
}

/**
 * Ordena las filas planas en una matriz:
 *   materias: [{ id, nombre, campo }]   (por campo de saberes y nombre)
 *   porEstudiante: { [estId]: { [materiaId]: { 1: fila, 2: fila, 3: fila } } }
 */
export function armarMatriz(filas) {
  const materias = new Map()
  const porEstudiante = {}
  for (const f of filas) {
    if (!materias.has(f.materia_id)) materias.set(f.materia_id, { id: f.materia_id, nombre: f.materia, campo: f.campo_saberes ?? '' })
    ;((porEstudiante[f.estudiante_id] ??= {})[f.materia_id] ??= {})[f.trimestre] = f
  }
  return {
    materias: [...materias.values()].sort((a, b) => a.campo.localeCompare(b.campo, 'es') || a.nombre.localeCompare(b.nombre, 'es')),
    porEstudiante,
  }
}

/** Promedio simple de las notas que existan (null si no hay ninguna). */
export function promedioSimple(valores) {
  const v = valores.filter(x => x != null && Number.isFinite(Number(x))).map(Number)
  return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null
}

/** Materia que no se imprime ni se muestra: en Secundaria desde 4° cada estudiante cursa su especialidad técnica. */
export function materiaOculta(nombreMateria, nivel, grado) {
  return nivel === 'Secundaria' && Number(grado) >= 4 && nombreMateria === 'Técnica Tecnológica General'
}

/**
 * Convierte las filas de asesor_notas_curso() (hacer_estado = 'calificada'|'pendiente', ...)
 * al formato que usa este módulo, y quita las materias ocultas del curso.
 * Si ninguna dimensión está calificada la nota se trata como "sin notas" (null).
 */
export function normalizarFilas(filas, curso) {
  return filas
    .filter(f => !materiaOculta(f.materia, curso?.nivel, curso?.grado))
    .map(f => {
      const h = f.hacer_estado === 'calificada', s = f.saber_estado === 'calificada'
      const se = f.ser_estado === 'calificada', d = f.decidir_estado === 'calificada'
      return {
        estudiante_id: f.estudiante_id, materia_id: f.materia_id, materia: f.materia, campo_saberes: f.campo_saberes ?? '',
        trimestre: f.trimestre,
        nota_final: (h || s || se || d) && f.nota_final != null ? Number(f.nota_final) : null,
        nota_hacer: h ? _num(f.nota_hacer) : null,
        nota_saber: s ? _num(f.nota_saber) : null,
        hacer_calificado: h, saber_calificado: s, ser_calificado: se, decidir_calificado: d,
        puntos_posibles: f.puntos_posibles,
      }
    })
}