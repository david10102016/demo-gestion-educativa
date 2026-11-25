// js/utils/libretas-curso.js
// Libretas PDF para el ASESOR DE CURSO: una individual o todas las del curso (ZIP).
// Reutiliza buildDoc() de generar-libreta-pdf.js (el mismo documento de siempre);
// solo cambia de dónde salen los datos: las funciones seguras del asesor
// (asesor_datos_libreta), porque un
// profesor no tiene permiso de leer las notas de otras materias directamente.
//
// El documento es el mismo formato informativo de la libreta existente: muestra la
// nota de cada trimestre que ya tiene calificaciones y marca "(En curso)" el promedio
// mientras faltan trimestres.
import { supabase } from '../config/supabase-config.js'
import { Config } from '../config/config-app.js'
import { paginar } from './paginar.js'
import { buildDoc } from './generar-libreta-pdf.js'
import { materiaOculta } from './estado-notas.js'

/** Carga una sola vez todo lo necesario del curso (función segura asesor_datos_libreta). */
export async function cargarDatosLibretas(cursoId) {
  const { data, error } = await supabase.rpc('asesor_datos_libreta', { p_curso_id: cursoId })
  if (error) throw error
  if (!data || Array.isArray(data) || !data.curso) throw new Error('No eres el asesor de este curso')

  // Datos de cabecera que la función no entrega (municipio, resolución, paralelo).
  // Si el perfil no puede leerlos, la libreta sale igual con esos campos en blanco.
  let colExtra = {}, paralelo = ''
  try {
    const { data: c } = await supabase.from('colegios')
      .select('municipio, departamento, resolucion_ministerial').single()
    colExtra = c ?? {}
  } catch { /* opcional */ }
  try {
    const { data: cu } = await supabase.from('cursos').select('paralelo').eq('id', cursoId).single()
    paralelo = cu?.paralelo ?? ''
  } catch { /* opcional */ }

  return {
    info: { ...data.curso, paralelo, colegio: { ...data.colegio, ...colExtra } },
    estudiantes: data.estudiantes ?? [],
    materias: data.materias ?? [],
    notas: data.notas ?? [],
  }
}

const gradoAplica = (v) => {
  const n = parseInt(String(v ?? '4').replace(/\D/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : 4
}

/** Arma los argumentos de buildDoc para un estudiante. */
export function datosLibretaEstudiante(datos, estudianteId) {
  const { info, estudiantes, materias: todas, notas } = datos
  const e = estudiantes.find(x => x.id === estudianteId)
  if (!e) throw new Error('El estudiante no pertenece al curso')

  const est = {
    carnet: e.carnet,
    usuarios: { nombre_completo: e.nombre_completo },
    curso: { nombre_completo: info.nombre_completo, nivel: info.nivel, grado: info.grado, paralelo: info.paralelo },
  }
  const col = info.colegio ?? {}

  const propias = notas.filter(n => n.estudiante_id === estudianteId)
  const notasMap = {}
  const conNota = new Set()
  for (const n of propias) {
    conNota.add(n.materia_id)
    if (n.nota_final != null) (notasMap[n.materia_id] ??= {})[n.trimestre] = Number(n.nota_final)
  }
  const grado = Number(info.grado) || 0
  // Regulares: todas las del nivel. Técnicas: solo la(s) de la especialidad inscrita
  // (el servidor ya devuelve notas solo de esas) y desde el grado en que aplican.
  let materias = todas.filter(m => !m.es_tecnica || (conNota.has(m.id) && grado >= gradoAplica(m.aplica_desde)))
  materias = materias.filter(m => !materiaOculta(m.nombre, info.nivel, info.grado))
  materias.sort((a, b) => (a.campo_saberes ?? '').localeCompare(b.campo_saberes ?? '', 'es') || (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'))

  return { est, col, materias, notasMap }
}

function _construirDoc(datos, estudianteId) {
  const { est, col, materias, notasMap } = datosLibretaEstudiante(datos, estudianteId)
  return { doc: buildDoc(est, col, materias, notasMap, Config.periodos), est }
}

function _nombreArchivo(est) {
  const apellidos = (est.usuarios?.nombre_completo ?? 'alumno')
    .trim().split(/\s+/).slice(0, 2).join('_')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_]/g, '')
  return `libreta_${apellidos}_${est.carnet}_${Config.año}.pdf`
}

/** Descarga la libreta de UN estudiante del curso. */
export async function descargarLibretaEstudiante(cursoId, estudianteId, datosPrecargados = null) {
  if (typeof pdfMake === 'undefined') throw new Error('La librería de PDF no está cargada')
  const datos = datosPrecargados ?? await cargarDatosLibretas(cursoId)
  const { doc, est } = _construirDoc(datos, estudianteId)
  pdfMake.createPdf(doc).download(_nombreArchivo(est))
}

/** Descarga todas las libretas del curso en un ZIP. onProgreso(hechas, total). */
export async function descargarLibretasCurso(cursoId, onProgreso = () => {}, datosPrecargados = null) {
  if (typeof pdfMake === 'undefined') throw new Error('La librería de PDF no está cargada')
  if (typeof JSZip === 'undefined') throw new Error('La librería de ZIP no está cargada')
  const datos = datosPrecargados ?? await cargarDatosLibretas(cursoId)
  const total = datos.estudiantes.length
  if (!total) throw new Error('El curso no tiene estudiantes')

  const zip = new JSZip()
  const carpeta = zip.folder(`Libretas_${datos.info.nombre_completo.replace(/[^a-zA-Z0-9]/g, '_')}_${Config.año}`)
  let hechas = 0
  for (const e of datos.estudiantes) {
    const { doc, est } = _construirDoc(datos, e.id)
    const buffer = await new Promise(resolve => pdfMake.createPdf(doc).getBuffer(resolve))
    carpeta.file(_nombreArchivo(est), buffer)
    onProgreso(++hechas, total)
    await new Promise(r => setTimeout(r, 0)) // cede el hilo para que se actualice la pantalla
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `Libretas_${datos.info.nombre_completo.replace(/[^a-zA-Z0-9]/g, '_')}_${Config.año}.zip`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
