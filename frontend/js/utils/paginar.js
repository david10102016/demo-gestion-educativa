// js/utils/paginar.js
// Trae TODAS las filas de una consulta de Supabase, sin el corte de ~1000 filas de PostgREST.
//
// Uso:
//   const { data, error } = await paginar(() =>
//     supabase.from('notas').select('actividad_id, estudiante_id, valor').in('actividad_id', ids))
//
// - Recibe una FUNCIÓN que arma la consulta desde cero: cada página necesita su propia consulta.
// - Agrega ORDER BY por columnas únicas (por defecto 'id') DESPUÉS de cualquier orden que ya traiga la
//   consulta, para que las páginas no repitan ni salten filas cuando hay empates.
// - Devuelve { data, error } igual que supabase, así sirve también dentro de `run:` de fetchConCache.
// - No usar con .single()/.maybeSingle(). Para vistas sin columna `id`, pasar el orden: ['col1', 'col2'].
export async function paginar(construir, orden = ['id'], tamano = 1000) {
  const todas = []
  for (let desde = 0; ; desde += tamano) {
    let q = construir()
    for (const col of orden) q = q.order(col)
    const { data, error } = await q.range(desde, desde + tamano - 1)
    if (error) return { data: null, error }
    const lote = data ?? []
    todas.push(...lote)
    if (lote.length < tamano) break
  }
  return { data: todas, error: null }
}