// js/utils/tecnica-grado.js
// Materias técnicas (BTH): una misma materia junta a los paralelos A, B y C de un grado,
// pero cada grado es un grupo aparte (5° no se mezcla con 6°).
// cursosDelGrado(cursoId) → ids de todos los paralelos del mismo nivel y grado que cursoId.
// Se usa para filtrar inscritos, actividades y asistencias técnicas por grado.
import { supabase } from '../config/supabase-config.js'

const _cache = new Map()

export async function cursosDelGrado(cursoId) {
  if (!cursoId) return []
  if (_cache.has(cursoId)) return _cache.get(cursoId)
  try {
    const { data: c, error } = await supabase.from('cursos')
      .select('colegio_id, nivel, grado').eq('id', cursoId).single()
    if (error || !c) return [cursoId]
    const { data } = await supabase.from('cursos').select('id')
      .eq('colegio_id', c.colegio_id).eq('nivel', c.nivel).eq('grado', c.grado)
    const ids = (data ?? []).map(x => x.id)
    if (!ids.includes(cursoId)) ids.push(cursoId)
    _cache.set(cursoId, ids)
    return ids
  } catch (_) {
    return [cursoId]   // sin conexión: al menos el paralelo elegido
  }
}