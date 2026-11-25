// js/utils/data-layer.js
// ─────────────────────────────────────────────────────────
// fetchConCache(): envuelve una consulta de LECTURA a Supabase.
//
// Comportamiento:
//  - Con internet: ejecuta la consulta normalmente. Si tiene éxito,
//    guarda una copia en IndexedDB y devuelve el dato fresco.
//  - Sin internet (o si la consulta falla): busca la última copia
//    guardada para esa misma clave y la devuelve, marcando
//    offline: true.
//  - Si no hay red NI copia guardada: devuelve el error tal cual,
//    para que la pantalla muestre su mensaje de error habitual.
//
// USO:
//   const r = await fetchConCache({
//     key: `notas:${cursoId}:${materiaId}:${periodo}`,
//     colegioId: perfil.colegio_id,
//     usuarioId: perfil.id,
//     run: () => supabase.from('notas').select('...').eq(...)
//   })
//   // r.data     -> los datos (frescos u offline)
//   // r.error    -> error real, solo si no había nada en cache
//   // r.offline  -> true si se sirvió desde cache local
//   // r.syncedAt -> timestamp (ms) de cuándo se guardó esa copia
//
// IMPORTANTE: esta función es SOLO para lecturas (select). Nunca
// se debe usar para insert/update/delete/upsert — esas siempre
// deben ir directo a Supabase y requerir conexión real.
// ─────────────────────────────────────────────────────────
import { getCache, setCache } from './offline-db.js'

function _buildKey(key, colegioId, usuarioId) {
  // La clave compuesta garantiza aislamiento multitenant:
  // nunca se lee cache de otro colegio ni de otro usuario.
  return `${key}::col_${colegioId ?? 'na'}::u_${usuarioId ?? 'na'}`
}

// navigator.onLine no es confiable: puede decir "conectado" aunque no haya
// salida real a internet (wifi sin señal, datos móviles sin cobertura).
// Por eso, además de chequear onLine, ponemos un límite de tiempo a
// cualquier consulta: si no responde en este plazo, se trata como si
// no hubiera conexión, en vez de dejar que el navegador espere solo
// (lo cual puede tardar 20-30+ segundos y sentirse como que la app
// "se colgó").
const TIMEOUT_MS_DEFAULT = 6000

export function conTimeout(promise, ms = TIMEOUT_MS_DEFAULT) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Sin respuesta del servidor (tiempo agotado)')), ms)
    Promise.resolve(promise).then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }
    )
  })
}

export async function fetchConCache({ key, colegioId, usuarioId, run, ms = TIMEOUT_MS_DEFAULT }) {
  const fullKey = _buildKey(key, colegioId, usuarioId)

  try {
    const result = await conTimeout(run(), ms)
    if (result?.error) throw result.error

    // Guardar copia para uso offline futuro (no bloquea el render actual)
    setCache(fullKey, result.data ?? null)

    return { data: result.data ?? null, error: null, offline: false, syncedAt: Date.now() }
  } catch (err) {
    const cached = await getCache(fullKey)
    if (cached) {
      console.warn(`[offline] Sin conexión — usando datos guardados para "${key}"`)
      return { data: cached.value, error: null, offline: true, syncedAt: cached.syncedAt }
    }
    // No hay red y tampoco hay nada guardado: se propaga el error real
    return { data: null, error: err, offline: false, syncedAt: null }
  }
}
