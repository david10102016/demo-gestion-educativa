// js/utils/gestion-cierre.js
import { supabase } from '../config/supabase-config.js'
import { Config, invalidarConfigCache } from '../config/config-app.js'
import { toast, mostrarLoader, ocultarLoader, confirmar } from './ui.js'
import { abrirPromocionGestion } from './promocion-gestion.js'

// ─── CERRAR GESTIÓN ──────────────────────────────────────
export async function cerrarGestionActual(colegioId) {
  const año = Config.año
  const añoSiguiente = año + 1

  if (!colegioId) { toast('No se pudo determinar el colegio', 'error'); return }

  if (!await confirmar(
    `Cerrar Gestión ${año}`,
    `Esta acción cerrará la gestión ${año}, bloqueará notas y asistencias, y creará automáticamente la gestión ${añoSiguiente}. ¿Confirmas?`
  )) return

  mostrarLoader('Cerrando gestión...')
  try {
    // 1. Obtener gestión actual
    const { data: gActual, error: errG } = await supabase
      .from('config_gestion')
      .select('*')
      .eq('año', año)
      .eq('colegio_id', colegioId)
      .single()
    if (errG || !gActual) throw new Error('No se encontró la gestión activa')

    // 2. Cerrar y bloquear gestión actual
    const { error: errCierre } = await supabase
      .from('config_gestion')
      .update({
        estado:       'cerrado',
        bloqueada:    true,
        fecha_cierre: new Date().toISOString()
      })
      .eq('id', gActual.id)
      .eq('colegio_id', colegioId)
    if (errCierre) throw errCierre

    // 3. Verificar si ya existe la gestión siguiente (de este colegio)
    const { data: gExiste } = await supabase
      .from('config_gestion')
      .select('id')
      .eq('año', añoSiguiente)
      .eq('colegio_id', colegioId)
      .maybeSingle()

    if (!gExiste) {
      // 4. Crear gestión siguiente heredando configuración
      const { data: nuevaGestion, error: errNueva } = await supabase
        .from('config_gestion')
        .insert({
          año:                    añoSiguiente,
          estado:                 'activo',
          cantidad_periodos:      gActual.cantidad_periodos,
          nombre_periodo:         gActual.nombre_periodo,
          nota_minima_aprobacion: gActual.nota_minima_aprobacion,
          escala_maxima:          gActual.escala_maxima,
          etiqueta_aprobado:      gActual.etiqueta_aprobado,
          etiqueta_reprobado:     gActual.etiqueta_reprobado,
          bloqueada:              false,
          colegio_id:             colegioId
        })
        .select()
        .single()
      if (errNueva) throw errNueva

      // 5. Copiar dimensiones
      const { data: dims } = await supabase
        .from('config_dimensiones')
        .select('*')
        .eq('gestion_id', gActual.id)
        .eq('colegio_id', colegioId)

      if (dims?.length) {
        const { error: errDims } = await supabase.from('config_dimensiones').insert(
          dims.map(d => ({
            gestion_id:    nuevaGestion.id,
            año:           añoSiguiente,
            codigo:        d.codigo,
            nombre_display: d.nombre_display,
            peso_maximo:   d.peso_maximo,
            tipo:          d.tipo,
            orden:         d.orden,
            colegio_id:    colegioId
          }))
        )
        if (errDims) throw errDims
      }

      // 6. Copiar categorías y subcriterios SER
      const { data: cats } = await supabase
        .from('config_categorias_ser')
        .select('*')
        .eq('año', año)
        .eq('colegio_id', colegioId)

      if (cats?.length) {
        for (const cat of cats) {
          const { data: nuevaCat, error: errCat } = await supabase
            .from('config_categorias_ser')
            .insert({ año: añoSiguiente, nombre: cat.nombre, orden: cat.orden, activo: cat.activo, colegio_id: colegioId })
            .select().single()
          if (errCat) throw errCat

          if (nuevaCat) {
            const { data: subs } = await supabase
              .from('config_subcriterios_ser')
              .select('*')
              .eq('año', año)
              .eq('categoria_id', cat.id)
              .eq('colegio_id', colegioId)

            if (subs?.length) {
              const { error: errSubs } = await supabase.from('config_subcriterios_ser').insert(
                subs.map(s => ({
                  año:         añoSiguiente,
                  categoria_id: nuevaCat.id,
                  texto:       s.texto,
                  descripcion: s.descripcion,
                  activo:      s.activo,
                  orden:       s.orden,
                  colegio_id:  colegioId
                }))
              )
              if (errSubs) throw errSubs
            }
          }
        }
      }
    }

    // 7. Invalidar caché para que el sistema detecte el nuevo año
    invalidarConfigCache()

    toast(`Gestión ${año} cerrada. Gestión ${añoSiguiente} creada correctamente.`, 'success')

    setTimeout(() => {
      window.location.reload()
    }, 2000)

  } catch(err) {
    toast('Error al cerrar la gestión: ' + (err.message ?? err), 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── DESBLOQUEAR GESTIÓN ─────────────────────────────────
export async function desbloquearGestion(año, colegioId) {
  if (!colegioId) { toast('No se pudo determinar el colegio', 'error'); return }

  if (!await confirmar(
    `Desbloquear Gestión ${año}`,
    `¿Deseas desbloquear la gestión ${año}? Los profesores podrán modificar notas y asistencias de ese año.`
  )) return

  mostrarLoader('Desbloqueando...')
  try {
    const { error } = await supabase
      .from('config_gestion')
      .update({ bloqueada: false })
      .eq('año', año)
      .eq('colegio_id', colegioId)
    if (error) throw error
    toast(`Gestión ${año} desbloqueada`, 'success')
  } catch(err) {
    toast('Error al desbloquear: ' + (err.message ?? err), 'error')
  } finally {
    ocultarLoader()
  }
}

// ─── BLOQUEAR GESTIÓN (re-bloquear) ──────────────────────
export async function bloquearGestion(año, colegioId) {
  if (!colegioId) { toast('No se pudo determinar el colegio', 'error'); return }

  if (!await confirmar(
    `Bloquear Gestión ${año}`,
    `¿Volver a bloquear la gestión ${año}?`
  )) return

  mostrarLoader('Bloqueando...')
  try {
    const { error } = await supabase
      .from('config_gestion')
      .update({ bloqueada: true })
      .eq('año', año)
      .eq('colegio_id', colegioId)
    if (error) throw error
    toast(`Gestión ${año} bloqueada nuevamente`, 'success')
  } catch(err) {
    toast('Error al bloquear: ' + (err.message ?? err), 'error')
  } finally {
    ocultarLoader()
  }
}
// ─── CIERRE CON REVISIÓN DE PROMOCIÓN (Fase 2, 062) ──────
export async function iniciarCierreConPromocion(colegioId) {
  if (!colegioId) { toast('No se pudo determinar el colegio', 'error'); return }

  const handler = async () => {
    document.removeEventListener('promocion-completada', handler)
    await cerrarGestionActual(colegioId)
  }
  document.addEventListener('promocion-completada', handler)

  await abrirPromocionGestion(colegioId)
}