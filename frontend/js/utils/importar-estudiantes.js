// js/utils/importar-estudiantes.js
// Utilidad para importación masiva de estudiantes via Excel
// Requiere SheetJS (XLSX) y Supabase

import { supabase } from '../config/supabase-config.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from './ui.js'
import { validarNombre } from './validaciones.js'
import { escapeHtml } from './sanitize.js'

/**
 * Parsea Excel y retorna array de estudiantes
 * Espera columnas: nombre/Nombre/Nombre Completo, carnet/Carnet, rude/RUDE (opcional), materia/Materia (opcional)
 */
export async function parseExcelEstudiantes(archivo) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = (e) => {
      try {
        const XLSX = window.XLSX
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]

        if (!sheet) {
          reject(new Error('El archivo Excel está vacío'))
          return
        }

        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

        if (rows.length === 0) {
          reject(new Error('No hay datos en el Excel'))
          return
        }

        const estudiantes = []
        const errores = []

        rows.forEach((row, idx) => {
          // Normalizar nombres de columnas
          const nombre = (row.nombre || row.Nombre || row['Nombre Completo'] || row.nombre_completo || '').toString().trim()
          const carnet = (row.carnet || row.Carnet || row.CARNET || row['Código'] || row.codigo || '').toString().trim()
          const materia = (row.materia || row.Materia || row['materia'] || row['Materia Técnica'] || '').toString().trim()
          const rudeCelda = row.rude ?? row.RUDE ?? row.Rude ?? row['Código RUDE'] ?? row['Codigo RUDE'] ?? row['Código Rude'] ?? ''
          // Excel guarda números largos con 15 dígitos: un RUDE numérico de más dígitos llega alterado
          if (typeof rudeCelda === 'number' && Math.abs(rudeCelda) >= 1e15) {
            errores.push({ fila: idx + 2, razon: 'RUDE guardado como número en Excel: formatee la columna RUDE como Texto' })
            return
          }
          const rude = rudeCelda.toString().trim()

          if (!nombre || !carnet) {
            errores.push({
              fila: idx + 2, // +2 porque excel empieza en 1 y hay header
              razon: 'Falta nombre o carnet'
            })
            return
          }

          const resNombre = validarNombre(nombre)
          if (!resNombre.valido) {
            errores.push({
              fila: idx + 2,
              razon: `Nombre inválido: ${resNombre.mensaje}`
            })
            return
          }

          // RUDE es opcional, pero si viene debe ser alfanumérico (8 a 30 caracteres)
          if (rude && !/^[A-Za-z0-9]{8,30}$/.test(rude)) {
            errores.push({
              fila: idx + 2,
              razon: `RUDE inválido: ${rude}`
            })
            return
          }

          estudiantes.push({
            nombre,
            carnet,
            rude: rude || null,
            materia: materia || null
          })
        })

        if (estudiantes.length === 0) {
          reject(new Error('No se encontraron estudiantes válidos en el Excel'))
          return
        }

        resolve({ estudiantes, errorValidacion: errores })
      } catch (err) {
        reject(new Error(`Error parseando Excel: ${err.message}`))
      }
    }

    reader.onerror = () => {
      reject(new Error('Error leyendo el archivo'))
    }

    reader.readAsArrayBuffer(archivo)
  })
}

/**
 * Llama la Edge Function para crear estudiantes en lote
 * @param {Array} estudiantes - Array con { nombre, carnet, rude, materia }
 * @param {String} cursoId - UUID del curso
 * @param {String} colegioId - UUID del colegio
 */
export async function importarEstudiantesMasivo(estudiantes, cursoId, colegioId) {
  try {
    // Agregar curso_id a cada estudiante
    const payload = estudiantes.map(est => ({
      ...est,
      curso_id: cursoId
    }))

    // Llamar Edge Function
    const { data, error } = await supabase.functions.invoke('crear-estudiantes-masivo', {
      body: {
        estudiantes: payload,
        colegio_id: colegioId
      }
    })

    if (error) {
      throw new Error(error.message || 'Error en la Edge Function')
    }

    return data
  } catch (err) {
    throw new Error(err.message || 'Error importando estudiantes')
  }
}

/**
 * Descarga Excel con los resultados de la importación
 * @param {Array} resultados - Array con datos creados
 * @param {String} nombreArchivo - Nombre del archivo (default: 'credenciales.xlsx')
 */
export function descargarResultadosExcel(resultados, nombreArchivo = 'credenciales_estudiantes.xlsx', nombreHoja = 'Estudiantes') {
  try {
    const XLSX = window.XLSX
    // Preparar datos para Excel
    const datos = resultados.map(r => ({
      'Carnet': r.carnet,
      'RUDE': r.rude || '',
      'Nombre': r.nombre,
      'Email': r.email,
      'Contraseña': r.password,
      'Usuario ID': r.usuario_id,
      'Estado': r.status
    }))

    // Crear workbook
    const worksheet = XLSX.utils.json_to_sheet(datos)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, String(nombreHoja).replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Estudiantes')

    // Ajustar ancho de columnas
    const colWidths = [
      { wch: 15 }, // Carnet
      { wch: 20 }, // RUDE
      { wch: 25 }, // Nombre
      { wch: 30 }, // Email
      { wch: 15 }, // Contraseña
      { wch: 36 }, // Usuario ID
      { wch: 12 }  // Estado
    ]
    worksheet['!cols'] = colWidths

    // Descargar
    XLSX.writeFile(workbook, nombreArchivo)
  } catch (err) {
    console.error('Error descargando Excel:', err)
    throw new Error('Error generando archivo de descarga')
  }
}

// Nombre legible del curso (ej. "1° Secundaria B") para el archivo de credenciales
async function nombreDelCurso(cursoId) {
  try {
    const { data } = await supabase.from('cursos').select('nombre_completo').eq('id', cursoId).single()
    if (data?.nombre_completo) return data.nombre_completo
  } catch (_) { /* sin nombre: se usa el genérico */ }
  return 'curso'
}

/**
 * Widget completo de importación
 * Gestiona el flujo completo: archivo → parse → import → download
 */
export async function mostrarWidgetImportacionEstudiantes(cursoId, colegioId) {
  const modalId = 'modal-importacion-estudiantes'

  // Crear modal si no existe
  if (!document.getElementById(modalId)) {
    const modal = document.createElement('div')
    modal.id = modalId
    modal.className = 'modal-overlay hidden'
    modal.innerHTML = `
      <div class="modal-box" style="max-width:560px;">
        <div class="modal-header">
          <h2>Importar Estudiantes</h2>
          <button onclick="document.getElementById('${modalId}').classList.add('hidden')" class="btn-close-modal">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Selecciona archivo Excel (XLS/XLSX)</label>
            <input type="file" id="archivo-importar" accept=".xlsx,.xls">
            <small style="color:var(--color-text-3);">Columnas requeridas: Nombre Completo, Carnet | Opcionales: RUDE, Materia</small>
          </div>
          <div id="resumen-importacion" class="hidden" style="margin-top:20px;">
            <h4 style="margin-bottom:8px;">Resumen de importación</h4>
            <p>✅ Creados: <strong id="count-creados">0</strong></p>
            <p>❌ Errores: <strong id="count-errores">0</strong></p>
            <button id="btn-descargar-credenciales" class="btn btn-secondary btn-sm hidden" style="margin-top:10px;">
              ⬇ Descargar credenciales (Excel)
            </button>
            <div id="lista-errores" class="hidden" style="margin-top:12px;background:var(--color-error-bg);padding:10px;border-radius:8px;max-height:200px;overflow-y:auto;">
              <strong>Detalles de errores:</strong>
              <ul id="errores-listado"></ul>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button onclick="document.getElementById('${modalId}').classList.add('hidden')" class="btn btn-secondary">Cancelar</button>
          <button id="btn-importar" class="btn btn-primary">Importar</button>
        </div>
      </div>
    `
    document.body.appendChild(modal)
  }

  const modal = document.getElementById(modalId)
  const inputArchivo = document.getElementById('archivo-importar')
  const btnImportar = document.getElementById('btn-importar')

  // Evento del botón importar
  btnImportar.onclick = async () => {
    const archivo = inputArchivo.files[0]
    if (!archivo) {
      toast('Selecciona un archivo Excel', 'warning')
      return
    }

    mostrarLoader('Procesando Excel...')

    try {
      // 1. Parsear Excel
      const { estudiantes: datosParseados, errorValidacion } = await parseExcelEstudiantes(archivo)

      if (errorValidacion.length > 0) {
        console.warn('Errores de validación:', errorValidacion)
        toast(`⚠️ ${errorValidacion.length} fila${errorValidacion.length !== 1 ? 's' : ''} omitida${errorValidacion.length !== 1 ? 's' : ''} por validación (filas: ${errorValidacion.map(e => e.fila).join(', ')})`, 'warning')
      }

      if (datosParseados.length === 0) {
        toast('El archivo no tiene estudiantes válidos para importar', 'warning')
        return
      }

      // Confirmación: curso destino, archivo y cantidad (evita importar al curso equivocado)
      ocultarLoader()
      const cursoDestino = await nombreDelCurso(cursoId)
      const normalizar = s => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f°º]/g, '').replace(/\s+/g, ' ').trim()
      const nombreArchivo = archivo.name.replace(/\.[^.]+$/, '')
      const coincide = normalizar(nombreArchivo).includes(normalizar(cursoDestino))
      const aviso = coincide ? '' : ` ⚠️ OJO: el nombre del archivo no coincide con el curso seleccionado.`
      const ok = await confirmar(
        `¿Importar a ${cursoDestino}?`,
        `Archivo: ${archivo.name} · ${datosParseados.length} estudiante${datosParseados.length !== 1 ? 's' : ''} válido${datosParseados.length !== 1 ? 's' : ''} se crearán en ${cursoDestino}.${aviso}`,
        'Sí, importar',
        'Cancelar'
      )
      if (!ok) { toast('Importación cancelada', 'info'); return }

      // 2. Importar a través de Edge Function
      mostrarLoader(`Creando ${datosParseados.length} estudiantes...`)
      const respuesta = await importarEstudiantesMasivo(datosParseados, cursoId, colegioId)
      console.log('RESPUESTA:', JSON.stringify(respuesta))

      // 3. Mostrar resumen
      document.getElementById('resumen-importacion').classList.remove('hidden')
      document.getElementById('count-creados').textContent = respuesta.datos_creados.length
      document.getElementById('count-errores').textContent = respuesta.errores.length

      if (respuesta.errores.length > 0) {
        const listaErrores = document.getElementById('errores-listado')
        listaErrores.innerHTML = respuesta.errores
          .map(e => `<li><strong>Fila ${e.row}:</strong> ${escapeHtml(e.carnet)} - ${escapeHtml(e.reason)}</li>`)
          .join('')
        document.getElementById('lista-errores').classList.remove('hidden')
      }

      // 4. Descargar resultados si hay creados
      const creados = respuesta?.datos_creados?.length ?? 0
      const errores = respuesta?.errores?.length ?? 0

      if (creados > 0) {
        // Credenciales: ya no se descargan solas. Botón opcional, con el curso en el nombre del archivo
        const nombreCurso = await nombreDelCurso(cursoId)
        const btnCred = document.getElementById('btn-descargar-credenciales')
        btnCred.textContent = `⬇ Descargar credenciales de ${nombreCurso} (Excel)`
        btnCred.onclick = () => descargarResultadosExcel(
          respuesta.datos_creados,
          `credenciales_${nombreCurso.replace(/°/g, '').replace(/[^\p{L}\p{N}]+/gu, '_')}.xlsx`,
          nombreCurso
        )
        btnCred.classList.remove('hidden')
        toast(`✅ ${creados} estudiante${creados !== 1 ? 's' : ''} creado${creados !== 1 ? 's' : ''} correctamente en ${nombreCurso}`, 'success')
      } else if (errores > 0) {
        toast(`No se pudo crear ningún estudiante. Revisa los errores.`, 'error')
      } else {
        toast('Importación finalizada sin resultados', 'warning')
      }

      if (creados > 0 && errores > 0) {
        toast(`⚠️ Se crearon ${creados}, pero hubo ${errores} error${errores !== 1 ? 'es' : ''}`, 'warning')
      }

      // Recargar lista + contador del Inicio. El modal queda abierto con el resumen
      // hasta que el director lo cierre.
      if (typeof window.cargarEstudiantes === 'function') {
        window.cargarEstudiantes()
      }
      if (typeof window.cargarEstadisticasInicio === 'function') {
        window.cargarEstadisticasInicio()
      }

    } catch (err) {
      toast(err.message, 'error')
      console.error('Error importando:', err)
    } finally {
      ocultarLoader()
    }
  }

  // Mostrar modal limpio (sin el resumen de una importación anterior)
  inputArchivo.value = ''
  document.getElementById('resumen-importacion').classList.add('hidden')
  document.getElementById('btn-descargar-credenciales').classList.add('hidden')
  document.getElementById('lista-errores').classList.add('hidden')
  document.getElementById('errores-listado').innerHTML = ''
  modal.classList.remove('hidden')
  inputArchivo.focus()
}