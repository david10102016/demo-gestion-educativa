// js/comunicados/comunicados.js
// Lógica compartida: enviar, listar, marcar leído
import { supabase } from '../config/supabase-config.js'

// ─── ENVIAR COMUNICADO ────────────────────────────────────────────────────────
export async function enviarComunicado({ perfil, tipo_emisor, tipo_destinatario, destinatario_id, materia_id, asunto, contenido, categoria, destinatario_nombre }) {
  const { data: com, error } = await supabase.from('comunicados').insert({
    colegio_id: perfil.colegio_id,
    emisor_id: perfil.id,
    tipo_emisor,
    tipo_destinatario,
    destinatario_id: destinatario_id || null,
    materia_id: materia_id || null,
    asunto, contenido, categoria,
    destinatario_nombre: destinatario_nombre || null
  }).select().single()

  if (error) throw error

  let estudiantesIds = []
  if (tipo_destinatario === 'colegio') {
    const { data } = await supabase.from('estudiantes').select('id').eq('colegio_id', perfil.colegio_id)
    estudiantesIds = (data ?? []).map(e => e.id)
  } else if (tipo_destinatario === 'curso') {
    const { data } = await supabase.from('estudiantes').select('id').eq('curso_id', destinatario_id)
    estudiantesIds = (data ?? []).map(e => e.id)
  } else {
    estudiantesIds = [destinatario_id]
  }

  if (estudiantesIds.length > 0) {
    const filas = estudiantesIds.map(id => ({ comunicado_id: com.id, estudiante_id: id }))
    const { error: e2 } = await supabase.from('comunicados_estudiante').insert(filas)
    if (e2) throw e2
  }

  return com
}

// ─── OBTENER COMUNICADOS DEL ESTUDIANTE ──────────────────────────────────────
export async function getComunicadosEstudiante(estudianteId) {
  const { data, error } = await supabase
    .from('comunicados_estudiante')
    .select(`
      id, leido_at,
      comunicado:comunicados(id, asunto, contenido, categoria, created_at,
        emisor:usuarios!comunicados_emisor_id_fkey(nombre_completo))
    `)
    .eq('estudiante_id', estudianteId)
    .order('comunicado(created_at)', { ascending: false })

  if (error) throw error
  return data ?? []
}

// ─── CONTAR NO LEÍDOS ─────────────────────────────────────────────────────────
export async function contarNoLeidos(estudianteId) {
  const { count } = await supabase
    .from('comunicados_estudiante')
    .select('id', { count: 'exact', head: true })
    .eq('estudiante_id', estudianteId)
    .is('leido_at', null)
  return count ?? 0
}

// ─── MARCAR COMO LEÍDO ────────────────────────────────────────────────────────
export async function marcarLeido(comunicadoEstudianteId) {
  await supabase.from('comunicados_estudiante')
    .update({ leido_at: new Date().toISOString() })
    .eq('id', comunicadoEstudianteId)
    .is('leido_at', null)
}

// ─── OBTENER COMUNICADOS ENVIADOS (PROFESOR/DIRECTOR) ────────────────────────
export async function getComunicadosEnviados(emisorId) {
  const { data } = await supabase
    .from('comunicados')
    .select(`
      id, asunto, categoria, tipo_destinatario, destinatario_nombre, contenido, created_at,
      total:comunicados_estudiante(count)
    `)
    .eq('emisor_id', emisorId)
    .order('created_at', { ascending: false })

  if (!data?.length) return []

  const ids = data.map(c => c.id)
  const { data: leidos } = await supabase
    .from('comunicados_estudiante')
    .select('comunicado_id')
    .in('comunicado_id', ids)
    .not('leido_at', 'is', null)

  const leidosMap = {}
  ;(leidos ?? []).forEach(r => {
    leidosMap[r.comunicado_id] = (leidosMap[r.comunicado_id] ?? 0) + 1
  })

  return data.map(c => ({
    ...c,
    leidos_count: leidosMap[c.id] ?? 0,
    total_count:  c.total?.[0]?.count ?? 0
  }))
}
// ─── LECTURA DEL PADRE (migración 115) ────────────────────────────────────────
// Registra que el tutor abrió el comunicado en su propio panel. La función de la base
// valida que sea tutor activo con vínculo activo; también pone leido_at si estaba vacío.
export async function marcarLeidoTutor(comunicadoEstudianteId) {
  const { error } = await supabase.rpc('marcar_comunicado_leido_tutor', { p_ce_id: comunicadoEstudianteId })
  if (error) throw error
}

// Trae todas las filas en bloques de 1000 (límite por consulta de Supabase)
async function traerTodo(consulta) {
  const salida = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await consulta().range(desde, desde + 999)
    if (error) throw error
    salida.push(...(data ?? []))
    if (!data || data.length < 1000) break
  }
  return salida
}

// ─── LECTURAS POR ESTUDIANTE (DIRECTOR / PROFESOR) ───────────────────────────
// Devuelve [{ nombre, leido_at, visto_padre_at, tiene_padre }] ordenado por nombre.
// tiene_padre: true/false solo si conVinculos (director: puede leer tutor_estudiante de su colegio);
// null para el profesor (por RLS no ve los vínculos, así que no se afirma nada).
export async function getLecturasComunicado(comunicadoId, { conVinculos = false } = {}) {
  const [filas, padres, vinculos] = await Promise.all([
    traerTodo(() => supabase
      .from('comunicados_estudiante')
      .select('id, estudiante_id, leido_at, estudiante:estudiantes(usuarios(nombre_completo))')
      .eq('comunicado_id', comunicadoId)
      .order('id')),
    traerTodo(() => supabase
      .from('comunicados_lectura_tutor')
      .select('comunicado_estudiante_id, leido_at, ce:comunicados_estudiante!inner(comunicado_id)')
      .eq('ce.comunicado_id', comunicadoId)
      .order('comunicado_estudiante_id')),
    conVinculos
      ? traerTodo(() => supabase.from('tutor_estudiante').select('estudiante_id').eq('activo', true).order('estudiante_id'))
      : Promise.resolve(null),
  ])
  const conPadre = vinculos ? new Set(vinculos.map(v => v.estudiante_id)) : null

  // Con 2 tutores por estudiante, se muestra la primera vez que un padre lo vio
  const vistoPadre = {}
  padres.forEach(p => {
    const previo = vistoPadre[p.comunicado_estudiante_id]
    if (!previo || p.leido_at < previo) vistoPadre[p.comunicado_estudiante_id] = p.leido_at
  })

  return filas
    .map(f => ({
      nombre: f.estudiante?.usuarios?.nombre_completo ?? '—',
      leido_at: f.leido_at,
      visto_padre_at: vistoPadre[f.id] ?? null,
      tiene_padre: conPadre ? conPadre.has(f.estudiante_id) : null,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

// ─── BANDEJA DEL PADRE (migración 115) ───────────────────────────────────────
// "Nuevo" para el padre = él no lo abrió en su panel. Lo leído antes de la 115 se respeta
// como estaba, para no reabrir avisos viejos. Devuelve null si no tiene hijos vinculados.
const INICIO_LECTURA_TUTOR = '2026-11-23T13:38:00-04:00'

export async function getComunicadosTutor(tutorId) {
  const { data: vinculos } = await supabase
    .from('tutor_estudiante').select('estudiante_id').eq('tutor_id', tutorId)
  const ids = (vinculos ?? []).map(v => v.estudiante_id)
  if (!ids.length) return null

  const [{ data: items, error }, { data: lecturas }] = await Promise.all([
    supabase
      .from('comunicados_estudiante')
      .select('id, leido_at, estudiante_id, comunicado:comunicados(id, asunto, contenido, categoria, created_at, emisor:usuarios!comunicados_emisor_id_fkey(nombre_completo))')
      .in('estudiante_id', ids)
      .order('comunicado(created_at)', { ascending: false }),
    supabase
      .from('comunicados_lectura_tutor')
      .select('comunicado_estudiante_id, leido_at')
      .eq('tutor_id', tutorId),
  ])
  if (error) throw error

  const mias = new Map((lecturas ?? []).map(l => [l.comunicado_estudiante_id, l.leido_at]))
  const inicio = new Date(INICIO_LECTURA_TUTOR)
  return (items ?? []).map(it => ({
    ...it,
    leido_at: mias.get(it.id) ?? (it.leido_at && new Date(it.leido_at) < inicio ? it.leido_at : null)
  }))
}

export async function contarNoLeidosTutor(tutorId) {
  const items = await getComunicadosTutor(tutorId)
  return (items ?? []).filter(i => !i.leido_at).length
}

// ─── RESUMEN DE ENVIADOS POR PÁGINA (DIRECTOR / PROFESOR, migración 118) ─────
// total = destinatarios · leidos = familias que lo leyeron (estudiante o padre).
// Director: comunicados de su colegio; profesor: los suyos (lo decide la base).
export async function getResumenEnviados(desde = 0, limite = 50) {
  const { data, error } = await supabase.rpc('resumen_comunicados', { p_desde: desde, p_limite: limite })
  if (error) throw error
  return (data ?? []).map(c => ({
    ...c,
    leidos_count: Number(c.leidos ?? 0),
    total_count:  Number(c.total ?? 0),
  }))
}