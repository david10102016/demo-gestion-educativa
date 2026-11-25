// demo-entrar — Entrada con un clic a una cuenta de prueba (solo en el PROYECTO DEMO)
//
// Recibe { slug, clave } (ej. { slug: "san-jose", clave: "director" }).
// Si el colegio es demo y está vigente, inicia sesión EN EL SERVIDOR con el usuario
// de ese rol y devuelve solo los tokens de sesión. La contraseña nunca sale del servidor.
//
// Variables (las pone Supabase): SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
// Además: DEMO_HABILITADO=true (sin esto la función no hace nada; protege a producción).

import { createClient } from "npm:@supabase/supabase-js@2"

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

const SLUG_OK  = /^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/
const CLAVE_OK = /^[a-z0-9]{2,20}$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido' })
  if (Deno.env.get('DEMO_HABILITADO') !== 'true') return json(403, { error: 'Función no disponible' })

  try {
    const url     = Deno.env.get('SUPABASE_URL') ?? ''
    const anon    = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    const { slug, clave } = await req.json().catch(() => ({}))
    if (!SLUG_OK.test(String(slug ?? '')) || !CLAVE_OK.test(String(clave ?? ''))) {
      return json(400, { error: 'Enlace o rol inválido' })
    }

    const admin = createClient(url, service, { auth: { persistSession: false } })

    const { data: estado, error: errEstado } = await admin.rpc('demo_por_slug', { p_slug: slug })
    if (errEstado) return json(500, { error: 'No se pudo consultar la cuenta de prueba' })
    if (!estado) return json(404, { error: 'Esta cuenta de prueba no existe' })
    if (estado.estado === 'vencido') return json(403, { error: 'vencido', mensaje: 'La cuenta de prueba terminó' })
    if (estado.estado === 'no_iniciado') return json(403, { error: 'no_iniciado', mensaje: `La cuenta de prueba empieza el ${estado.desde}` })

    const { data: cred, error: errCred } = await admin
      .from('demo_credenciales')
      .select('email, password, rol, mostrar')
      .eq('colegio_id', estado.colegio_id)
      .eq('clave', clave)
      .maybeSingle()
    if (errCred || !cred || !cred.mostrar) return json(404, { error: 'Rol no disponible en esta cuenta de prueba' })

    // Inicio de sesión en el servidor (cliente nuevo, sin guardar nada)
    const publico = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: ses, error: errSes } = await publico.auth.signInWithPassword({ email: cred.email, password: cred.password })
    if (errSes || !ses?.session) return json(500, { error: 'No se pudo abrir la sesión de prueba' })

    await admin.rpc('demo_registrar_ingreso', { p_colegio: estado.colegio_id, p_clave: clave })

    return json(200, {
      access_token:  ses.session.access_token,
      refresh_token: ses.session.refresh_token,
      rol:           cred.rol,
      colegio: {
        id: estado.colegio_id, nombre: estado.nombre, sigla: estado.sigla, logo_url: estado.logo_url,
        color_primario: estado.color_primario, color_secundario: estado.color_secundario,
      },
    })
  } catch (_e) {
    return json(500, { error: 'Error inesperado' })
  }
})
