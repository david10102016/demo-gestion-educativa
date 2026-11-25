// js/pagos/pagos.js
// Lógica principal del módulo de pagos.
// Maneja: registro de tutores, vinculación de hijos,
// subida de comprobantes y gestión de estados.
import { supabase } from '../config/supabase-config.js'
import { subirComprobantePago } from '../utils/almacenamiento.js'
import {
  ConfigPagos,
  cargarConfigPagos,
  obtenerColegioId,
  tieneBeca,
  montoConBeca,
  formatBs,
  resumenPagosEstudiante
} from '../config/config-pagos.js'

// -------------------------------------------------------
// REGISTRO DE TUTOR
// Dos vías: desde la web (el padre solo) o desde el colegio (la secretaria)
// En ambos casos el usuario base ya existe en auth.users
// -------------------------------------------------------

/**
 * Crear perfil de tutor en tutores_familia
 * Se llama después de que Supabase Auth crea el usuario
 */
export async function crearPerfilTutor(userId, datos = {}) {
  const colegioId = await obtenerColegioId()

  const { error } = await supabase
    .from('tutores_familia')
    .insert({
      id:         userId,
      colegio_id: colegioId,
      telefono:   datos.telefono ?? null,
      carnet:     datos.carnet ?? null
    })

  if (error) throw error
  return true
}

/**
 * Registrar tutor desde la web (el padre se registra solo)
 * Crea el usuario en auth y el perfil en tutores_familia
 */
export async function registrarTutorDesdeWeb(datos) {
  const { nombre_completo, email, password, telefono } = datos

  // Crear usuario en Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        nombre_completo,
        rol: 'tutor'
      }
    }
  })

  if (authError) throw authError

  const userId = authData.user.id

  // Insertar en public.usuarios (el trigger handle_new_user lo hace automático,
  // pero nos aseguramos que el rol sea tutor)
  await supabase
    .from('usuarios')
    .update({ nombre_completo, rol: 'tutor' })
    .eq('id', userId)

  // Crear perfil extendido en tutores_familia
  await crearPerfilTutor(userId, { telefono })

  return authData
}

// -------------------------------------------------------
// VINCULACIÓN DE HIJOS
// El tutor ingresa el carnet del estudiante
// El sistema valida y vincula
// -------------------------------------------------------

/**
 * Buscar estudiante por carnet para mostrar al tutor antes de vincular
 * Retorna los datos básicos del estudiante si existe
 */
export async function buscarEstudiantePorCarnet(carnet, colegioId) {
  if (!colegioId) {
    throw new Error('No se encontró el colegio de la sesión. Vuelve a iniciar sesión.')
  }
  const { data, error } = await supabase
    .rpc('buscar_estudiante_por_carnet', { p_carnet: carnet.trim(), p_colegio_id: colegioId })
  if (error) {
    console.log('error búsqueda carnet:', error)
    throw new Error(error.message || 'Error al buscar el estudiante')
  }
  const est = data?.[0]
  if (!est) return null
  return {
    id: est.id, carnet: est.carnet, nombre: est.nombre ?? 'Sin nombre',
    curso: est.curso ?? 'Sin curso', nivel: est.nivel ?? null,
    colegio_id: est.colegio_id
  }
}


/**
 * Vincular un hijo al tutor actual
 * Verifica que no esté ya vinculado
 */
export async function vincularHijo(estudianteId, parentesco = 'padre') {
  const { error } = await supabase
    .rpc('vincular_hijo_seguro', {
      p_estudiante_id: estudianteId,
      p_parentesco: parentesco
    })
  if (error) throw new Error(error.message || 'Error al vincular')
  return true
}

/**
 * Obtener todos los hijos vinculados al tutor actual
 * Con su nivel, curso y resumen de pagos del año
 */
export async function obtenerHijosDelTutor(año) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data, error } = await supabase
    .from('tutor_estudiante')
    .select(`
      id,
      parentesco,
      estudiante_id,
      estudiantes!inner (
        id,
        carnet,
        colegio_id,
        usuarios!inner ( nombre_completo, activo ),
        cursos ( nombre_completo, nivel, grado, paralelo )
      )
    `)
    .eq('tutor_id', user.id)
    .eq('activo', true)

  if (error || !data) return []

  // Para cada hijo obtener resumen de pagos y beca
  const hijos = await Promise.all(data.map(async (v) => {
    const est = v.estudiantes
    const nivel = est.cursos?.nivel ?? null
    const [resumen, beca] = await Promise.all([
      resumenPagosEstudiante(est.id, año),
      tieneBeca(est.id, año)
    ])

    const mesesActivos = ConfigPagos.mesesActivos(nivel)
    const montoMes     = ConfigPagos.monto(nivel, mesesActivos[0])
    const montoReal    = montoConBeca(montoMes, beca)
    const totalAnual   = mesesActivos.reduce((s, mes) => {
      return s + montoConBeca(ConfigPagos.monto(nivel, mes), beca)
    }, 0)

    return {
      vinculacionId: v.id,
      parentesco:    v.parentesco,
      id:            est.id,
      carnet:        est.carnet,
      nombre:        est.usuarios.nombre_completo,
      curso:         est.cursos?.nombre_completo ?? 'Sin curso',
      nivel,
      beca,
      montoMes:      montoReal,
      totalAnual,
      activo:        est.usuarios.activo !== false,
      colegioId:     est.colegio_id,
      resumen:       resumen ?? { aprobados: 0, pendientes: 0, rechazados: 0, totalPagado: 0, mesesPagados: [], mesesPendientes: [] }
    }
  }))

  // Nombre del colegio para los hijos inactivos ("Inactivo en <colegio>")
  const idsCol = [...new Set(hijos.filter(h => !h.activo).map(h => h.colegioId).filter(Boolean))]
  if (idsCol.length) {
    const { data: cols } = await supabase.from('colegios').select('id, nombre').in('id', idsCol)
    hijos.forEach(h => { if (!h.activo) h.colegioNombre = (cols ?? []).find(c => c.id === h.colegioId)?.nombre ?? 'el colegio' })
  }

  return hijos
}

// -------------------------------------------------------
// SUBIDA DE COMPROBANTE
// Un comprobante puede cubrir varios hijos en el mismo mes
// Se sube al almacenamiento configurado (Cloudinary en producción) y se guarda la URL en Supabase
// -------------------------------------------------------

/** Subir comprobante: devuelve { url, nombre } */
export async function subirComprobante(archivo, tutorId) {
  const url = await subirComprobantePago(archivo, tutorId)
  return { url, nombre: archivo.name }
}

/**
 * Registrar pagos — un comprobante para uno o varios hijos
 * @param {Array} hijos — [{ estudianteId, nivel, mes, año }]
 * @param {string} comprobanteUrl — URL de Cloudinary
 * @param {string} comprobanteNombre — nombre del archivo
 * @param {string} observacion — nota opcional del tutor
 */
export async function registrarPagos(hijos, comprobanteUrl, comprobanteNombre, observacion = '', numeroTransaccion = '', montoDeclarado = null) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay sesión activa')

  const colegioId = await obtenerColegioId()

  const registros = await Promise.all(hijos.map(async (hijo) => {
    const beca   = await tieneBeca(hijo.estudianteId, hijo.año)
    const monto  = montoConBeca(ConfigPagos.monto(hijo.nivel, hijo.mes), beca)

    return {
      estudiante_id:        hijo.estudianteId,
      tutor_id:             user.id,
      colegio_id:           colegioId,
      año:                  hijo.año,
      mes:                  hijo.mes,
      monto_bs:             monto,
      estado:               'pendiente',
      comprobante_url:      comprobanteUrl ?? null,
      comprobante_nombre:   comprobanteNombre ?? null,
      observacion_tutor:    observacion || null,
      numero_transaccion:   numeroTransaccion || null,
      monto_declarado:      montoDeclarado ?? null
    }
  }))

  const { error } = await supabase
    .from('pagos_mensualidad')
    .insert(registros)

  if (error) {
    if (error.code === '23505') {
      throw new Error('Uno o más pagos ya fueron registrados para ese mes')
    }
    throw error
  }

  return true
}

// -------------------------------------------------------
// PANEL DE SECRETARIA
// Ver pagos pendientes, aprobar o rechazar
// -------------------------------------------------------

/**
 * Obtener pagos pendientes o en revisión para la bandeja de la secretaria
 */
export async function obtenerPagosPendientes() {
  const { data, error } = await supabase
    .from('pagos_mensualidad')
    .select(`
      id,
      año,
      mes,
      monto_bs,
      estado,
      comprobante_url,
      comprobante_nombre,
      observacion_tutor,
      numero_transaccion,
      monto_declarado,
      created_at,
      estudiantes!inner (
        carnet,
        usuarios!inner ( nombre_completo ),
        cursos ( nombre_completo, nivel )
      ),
      tutores_familia!inner (
        usuarios!inner ( nombre_completo, email )
      )
    `)
    .in('estado', ['pendiente', 'en_revision'])
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * Aprobar o rechazar un pago
 * Actualiza el estado en pagos_mensualidad y registra en revisiones_pago
 */
export async function revisarPago(pagoId, accion, observacion = '') {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No hay sesión activa')

  if (!['aprobado', 'rechazado'].includes(accion)) {
    throw new Error('Acción inválida')
  }

  // Actualizar estado del pago
  const { error: errorPago } = await supabase
    .from('pagos_mensualidad')
    .update({ estado: accion })
    .eq('id', pagoId)

  if (errorPago) throw errorPago

  // Registrar la revisión en el log de auditoría
  const { error: errorRevision } = await supabase
    .from('revisiones_pago')
    .insert({
      pago_id:      pagoId,
      revisado_por: user.id,
      accion,
      observacion:  observacion || null
    })

  if (errorRevision) throw errorRevision

  return true
}

// -------------------------------------------------------
// PANEL DEL DIRECTOR
// Reportes y estadísticas de pagos
// -------------------------------------------------------

/**
 * Resumen general de pagos por año y colegio
 * Para el indicador de meta vs cobrado
 */
export async function resumenGeneralPagos(año, colegioId) {
  const { data, error } = await supabase
    .from('pagos_mensualidad')
    .select('estado, monto_bs')
    .eq('año', año)
    .eq('colegio_id', colegioId)

  if (error) throw error

  const aprobados  = (data ?? []).filter(p => p.estado === 'aprobado')
  const pendientes = (data ?? []).filter(p => ['pendiente', 'en_revision'].includes(p.estado))

  return {
    totalCobrado:   aprobados.reduce((s, p) => s + Number(p.monto_bs), 0),
    totalPendiente: pendientes.reduce((s, p) => s + Number(p.monto_bs), 0),
    cantAprobados:  aprobados.length,
    cantPendientes: pendientes.length
  }
}

/**
 * Pagos por curso — para que el director filtre por grado/paralelo
 */
export async function pagosPorCurso(cursoId, año) {
  const { data, error } = await supabase
    .from('pagos_mensualidad')
    .select(`
      id,
      mes,
      monto_bs,
      estado,
      estudiantes!inner (
        carnet,
        curso_id,
        usuarios!inner ( nombre_completo ),
        cursos!inner ( id, nombre_completo, nivel )
      )
    `)
    .eq('año', año)
    .eq('estudiantes.curso_id', cursoId)
    .order('mes')

  if (error) throw error
  return data ?? []
}

/**
 * Lista de morosos — estudiantes con meses sin pagar
 * Compara los meses activos configurados con los meses aprobados
 */
export async function obtenerMorosos(año, colegioId) {
  // Obtener todos los estudiantes del colegio con sus pagos aprobados
  const { data: estudiantes, error } = await supabase
    .from('estudiantes')
    .select(`
      id,
      carnet,
      colegio_id,
      usuarios!inner ( nombre_completo ),
      cursos!inner ( nombre_completo, nivel ),
      pagos_mensualidad ( mes, estado, año )
    `)
    .eq('colegio_id', colegioId)

  if (error) throw error

  const morosos = []

  for (const est of (estudiantes ?? [])) {
    const nivel        = est.cursos?.nivel ?? null
    const mesesActivos = ConfigPagos.mesesActivos(nivel)
    const pagosAño     = (est.pagos_mensualidad ?? []).filter(p => p.año === año)
    const mesesPagados = pagosAño
      .filter(p => p.estado === 'aprobado')
      .map(p => p.mes)

    const mesesDeuda = mesesActivos.filter(m => !mesesPagados.includes(m))

    if (mesesDeuda.length > 0) {
      const deudaTotal = mesesDeuda.reduce((s, mes) => {
        return s + ConfigPagos.monto(nivel, mes)
      }, 0)

      morosos.push({
        estudianteId: est.id,
        carnet:       est.carnet,
        nombre:       est.usuarios.nombre_completo,
        curso:        est.cursos?.nombre_completo ?? '-',
        nivel,
        mesesDeuda,
        deudaTotal
      })
    }
  }

  return morosos.sort((a, b) => b.deudaTotal - a.deudaTotal)
}

// -------------------------------------------------------
// GESTIÓN DE BECAS — solo director
// -------------------------------------------------------

/**
 * Asignar beca a un estudiante
 */
export async function asignarBeca(estudianteId, año, porcentaje = 100, motivo = '') {
  const { data: { user } } = await supabase.auth.getUser()
  const colegioId = await obtenerColegioId()

  const { error } = await supabase
    .from('becas_estudiante')
    .upsert({
      estudiante_id: estudianteId,
      colegio_id:    colegioId,
      año,
      porcentaje,
      motivo:        motivo || null,
      asignado_por:  user.id,
      activo:        true
    }, { onConflict: 'estudiante_id,año' })

  if (error) throw error
  return true
}

/**
 * Revocar beca de un estudiante
 */
export async function revocarBeca(estudianteId, año) {
  const { error } = await supabase
    .from('becas_estudiante')
    .update({ activo: false })
    .eq('estudiante_id', estudianteId)
    .eq('año', año)

  if (error) throw error
  return true
}

/**
 * Obtener todas las becas activas del colegio en un año
 */
export async function obtenerBecas(año, colegioId) {
  const { data, error } = await supabase
    .from('becas_estudiante')
    .select(`
      id,
      porcentaje,
      motivo,
      año,
      created_at,
      estudiantes!inner (
        carnet,
        usuarios!inner ( nombre_completo ),
        cursos ( nombre_completo, nivel )
      ),
      usuarios ( nombre_completo )
    `)
    .eq('año', año)
    .eq('colegio_id', colegioId)
    .eq('activo', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  return data ?? []
}
/**
 * Registrar un pago en efectivo, cargado por secretaria.
 * No requiere cuenta de tutor — queda atado directo al estudiante.
 * Se aprueba de inmediato porque ya se cobró en mano.
 */
export async function registrarPagoEfectivo(estudianteId, año, mes, montoBs, nombrePagador, observacion = '') {
  const { data: { user } } = await supabase.auth.getUser()

  const { data: est, error: errEst } = await supabase
    .from('estudiantes')
    .select('colegio_id')
    .eq('id', estudianteId)
    .single()
  if (errEst) throw errEst

  const { data, error } = await supabase
    .from('pagos_mensualidad')
    .insert({
      estudiante_id: estudianteId,
      tutor_id: null,
      año,
      mes,
      monto_bs: montoBs,
      estado: 'aprobado',
      nombre_pagador: nombrePagador,
      registrado_por: user.id,
      observacion_tutor: observacion || null,
      colegio_id: est.colegio_id
    })
    .select()
    .single()

  if (error) throw error
  return data
}