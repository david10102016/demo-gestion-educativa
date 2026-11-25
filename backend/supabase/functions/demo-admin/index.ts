// demo-admin — Administración de cuentas de prueba (solo superadmin, solo en el PROYECTO DEMO)
//
// Acciones (POST { accion, ... }):
//   crear     { nombre, contacto, desde, hasta }  -> crea colegio, usuarios de cada rol y datos de ejemplo
//   reiniciar { colegio_id }                      -> vuelve a los datos de ejemplo (mismo enlace y vigencia)
//   eliminar  { colegio_id }                      -> borra el demo, sus usuarios de Auth y sus archivos
//   limpiar   {}                                  -> borra los demos vencidos hace más de DEMO_DIAS_GRACIA días (3)
//
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (las pone Supabase)
//            DEMO_HABILITADO=true, DEMO_DOMINIO_CORREO (opcional, por defecto "demo.invalid"),
//            DEMO_DIAS_GRACIA (opcional, por defecto 3)

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/
const UUID_OK  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function contrasenaAleatoria(): string {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
  const bytes = new Uint8Array(28)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => letras[b % letras.length]).join('')
}

interface Persona { clave: string; rol: string; nombre: string; etiqueta: string; mostrar: boolean; orden: number }

// Borra usuarios de Auth (sus perfiles y datos se borran en cascada) y archivos del colegio
async function borrarDemo(admin: SupabaseClient, colegioId: string) {
  // Los usuarios sembrados y también los que el director haya creado durante la prueba
  const { data: creds } = await admin.from('demo_credenciales').select('usuario_id').eq('colegio_id', colegioId)
  const { data: propios } = await admin.from('usuarios').select('id').eq('colegio_id', colegioId).neq('rol', 'superadmin')
  const ids = new Set<string>([...(creds ?? []).map(c => c.usuario_id), ...(propios ?? []).map(u => u.id)].filter(Boolean))
  for (const id of ids) {
    await admin.auth.admin.deleteUser(id).catch(() => null)
  }
  // Archivos subidos durante la prueba: toda la carpeta del colegio en el bucket del demo
  // (entregas/, consignas/, pagos/<tutor>/ ...), recorrida por niveles
  try {
    const bucket = admin.storage.from('archivos-demo')
    const pendientes = [colegioId]
    let vueltas = 0
    while (pendientes.length && vueltas++ < 200) {
      const ruta = pendientes.shift() as string
      const { data: lista } = await bucket.list(ruta, { limit: 1000 })
      const archivos: string[] = []
      for (const f of lista ?? []) {
        if (f.id) archivos.push(`${ruta}/${f.name}`)   // archivo
        else pendientes.push(`${ruta}/${f.name}`)     // subcarpeta
      }
      if (archivos.length) await bucket.remove(archivos)
    }
  } catch (_) { /* los archivos son opcionales */ }
  const { error } = await admin.rpc('demo_eliminar_colegio', { p_colegio: colegioId })
  if (error) throw new Error(error.message)
}

async function crearDemo(admin: SupabaseClient, p: { nombre: string; contacto?: string; desde: string; hasta: string; slug?: string }) {
  const dominio = Deno.env.get('DEMO_DOMINIO_CORREO') || 'demo.invalid'

  const { data: base, error: errBase } = await admin.rpc('demo_crear_colegio', {
    p_nombre: p.nombre, p_contacto: p.contacto ?? null, p_desde: p.desde, p_hasta: p.hasta, p_slug: p.slug ?? null,
  })
  if (errBase || !base) throw new Error(errBase?.message ?? 'No se pudo crear el colegio')
  const colegioId: string = base.colegio_id
  const slug: string = base.slug

  try {
    const { data: personas, error: errP } = await admin.rpc('demo_personas')
    if (errP || !personas?.length) throw new Error('No se pudo leer la lista de usuarios de ejemplo')

    const mapa: Record<string, string> = {}
    for (const per of personas as Persona[]) {
      const email = `${per.clave}.${slug}@${dominio}`
      const password = contrasenaAleatoria()
      const { data: creado, error: errU } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nombre_completo: per.nombre },
      })
      if (errU || !creado?.user) throw new Error(`No se pudo crear el usuario ${per.clave}: ${errU?.message ?? ''}`)
      mapa[per.clave] = creado.user.id
      const { error: errC } = await admin.from('demo_credenciales').insert({
        colegio_id: colegioId, clave: per.clave, rol: per.rol, etiqueta: per.etiqueta,
        mostrar: per.mostrar, orden: per.orden, usuario_id: creado.user.id, email, password,
      })
      if (errC) throw new Error(`No se pudo guardar el acceso de ${per.clave}: ${errC.message}`)
    }

    const { data: siembra, error: errS } = await admin.rpc('demo_sembrar', { p_colegio: colegioId, p_usuarios: mapa })
    if (errS) throw new Error(`No se pudieron cargar los datos de ejemplo: ${errS.message}`)
    return { colegio_id: colegioId, slug, siembra }
  } catch (e) {
    // Si algo falló a medio camino, no deja un demo incompleto
    await borrarDemo(admin, colegioId).catch(() => null)
    throw e
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' })
  if (Deno.env.get('DEMO_HABILITADO') !== 'true') return json(403, { error: 'Función no disponible' })

  try {
    const url     = Deno.env.get('SUPABASE_URL') ?? ''
    const anon    = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    // ── Solo el superadmin ──
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) return json(401, { error: 'No autorizado' })
    const { data: quien, error: errQuien } = await createClient(url, anon).auth.getUser(token)
    if (errQuien || !quien?.user) return json(401, { error: 'Sesión inválida' })

    const admin = createClient(url, service, { auth: { persistSession: false } })
    const { data: perfil } = await admin.from('usuarios').select('rol, activo').eq('id', quien.user.id).maybeSingle()
    if (!perfil || perfil.rol !== 'superadmin' || !perfil.activo) return json(403, { error: 'Solo el administrador' })

    const body = await req.json().catch(() => ({}))
    const accion = String(body.accion ?? '')

    if (accion === 'crear') {
      const nombre = String(body.nombre ?? '').trim()
      const contacto = String(body.contacto ?? '').trim()
      if (nombre.length < 3 || nombre.length > 120) return json(400, { error: 'Nombre del colegio inválido' })
      if (!FECHA_OK.test(body.desde ?? '') || !FECHA_OK.test(body.hasta ?? '')) return json(400, { error: 'Fechas inválidas' })
      if (body.hasta < body.desde) return json(400, { error: 'La fecha final es anterior a la inicial' })
      const r = await crearDemo(admin, { nombre, contacto, desde: body.desde, hasta: body.hasta })
      return json(200, r)
    }

    if (accion === 'reiniciar' || accion === 'eliminar') {
      if (!UUID_OK.test(String(body.colegio_id ?? ''))) return json(400, { error: 'Demo inválido' })
      const { data: col } = await admin.from('colegios')
        .select('id, nombre, demo_slug, demo_contacto, demo_desde, demo_hasta, es_demo')
        .eq('id', body.colegio_id).maybeSingle()
      if (!col?.es_demo) return json(404, { error: 'Demo no encontrado' })

      await borrarDemo(admin, col.id)
      if (accion === 'eliminar') return json(200, { ok: true })

      const r = await crearDemo(admin, {
        nombre: col.nombre, contacto: col.demo_contacto ?? '', desde: col.demo_desde, hasta: col.demo_hasta, slug: col.demo_slug,
      })
      return json(200, r)
    }

    if (accion === 'limpiar') {
      const gracia = Number(Deno.env.get('DEMO_DIAS_GRACIA') ?? '3') || 3
      const limite = new Date(Date.now() - gracia * 86400000).toISOString().slice(0, 10)
      const { data: vencidos } = await admin.from('colegios').select('id').eq('es_demo', true).lt('demo_hasta', limite)
      for (const v of vencidos ?? []) await borrarDemo(admin, v.id)
      return json(200, { ok: true, borrados: (vencidos ?? []).length })
    }

    return json(400, { error: 'Acción no reconocida' })
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'Error inesperado' })
  }
})
