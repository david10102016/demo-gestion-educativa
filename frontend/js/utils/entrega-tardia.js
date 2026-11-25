// js/utils/entrega-tardia.js
// Lógica pura (sin Supabase ni DOM) para entregas fuera de plazo.
// Usada por: entrega-tareas.js, estudiante.js, mis-tareas.js, vista-calificaciones.js
//
// Regla: una entrega es "tardía" si su última subida (updated_at) fue DESPUÉS del
// límite VIGENTE de la actividad (fecha_limite + hora_limite, por defecto 23:59).
// Como se compara contra el límite vigente, si el profesor amplía la fecha la marca
// desaparece sola, sin recalcular ni guardar nada.

/** Límite de la actividad como Date en hora local, o null si no tiene fecha. */
export function limiteDeActividad(a) {
  if (!a?.fecha_limite) return null
  const [y, m, d] = String(a.fecha_limite).split('-').map(Number)
  const [hh, mm] = a.hora_limite ? String(a.hora_limite).split(':').map(Number) : [23, 59]
  return new Date(y, m - 1, d, hh, mm, 59, 999)
}

/** ¿Ya pasó el límite? (false si no hay fecha) */
export function estaVencida(a, ahora = new Date()) {
  const l = limiteDeActividad(a)
  return !!l && ahora > l
}

/** 5 min · 5 h 12 min · 2 días 3 h */
export function textoDuracion(ms) {
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) { const r = min % 60; return r ? `${h} h ${r} min` : `${h} h` }
  const d = Math.floor(h / 24), rh = h % 24
  const dias = `${d} ${d === 1 ? 'día' : 'días'}`
  return rh ? `${dias} ${rh} h` : dias
}

/**
 * Tardanza de la entrega de un estudiante en una actividad.
 * @param {object} act      { fecha_limite, hora_limite }
 * @param {Array}  entregas filas de entregas_tareas ({ updated_at, created_at })
 * @returns {null | { ms:number, texto:string }}  null = a tiempo, sin entrega o sin fecha
 */
export function tardanzaEntrega(act, entregas) {
  const limite = limiteDeActividad(act)
  if (!limite || !entregas?.length) return null
  const ultima = Math.max(...entregas.map(e => new Date(e.updated_at ?? e.created_at).getTime()))
  const ms = ultima - limite.getTime()
  return ms > 0 ? { ms, texto: textoDuracion(ms) } : null
}
