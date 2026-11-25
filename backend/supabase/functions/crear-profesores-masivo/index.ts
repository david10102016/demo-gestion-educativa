// Edge Function: crear-profesores-masivo
// Crea profesores en lote (máx. 50 por llamada) con correo del dominio del colegio,
// contraseña aleatoria y rollback si falla la asignación del rol. La lógica está en logica.ts.
import { serve } from "https://deno.land/std@0.201.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { crearProfesores, validarLlamante, MAX_POR_CARGA } from "./logica.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || ''
    if (!serviceRoleKey) return jsonResponse(401, { error: 'missing_service_role_key' })

    // ── 1) ¿Quién llama? ──
    const token = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    if (!token) return jsonResponse(401, { error: 'No autorizado' })

    const supabaseAuth = createClient(supabaseUrl, anonKey)
    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
    if (userError || !userData?.user) return jsonResponse(401, { error: 'Token inválido' })

    const supabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: llamante } = await supabase
      .from('usuarios').select('rol, activo, colegio_id').eq('id', userData.user.id).single()

    // ── 2) Datos de entrada ──
    let payload: any
    try { payload = await req.json() } catch (err) {
      return jsonResponse(400, { error: 'invalid_json', details: String(err) })
    }
    const { profesores, colegio_id } = payload ?? {}
    if (!Array.isArray(profesores) || profesores.length === 0) {
      return jsonResponse(400, { error: 'invalid_payload', details: 'profesores (array) requerido' })
    }
    if (profesores.length > MAX_POR_CARGA) {
      return jsonResponse(400, { error: 'demasiados_profesores', details: `Máximo ${MAX_POR_CARGA} por carga. Divide la lista.` })
    }

    // ── 3) Permisos: director solo en su colegio; superadmin en cualquiera ──
    const permiso = validarLlamante(llamante, colegio_id)
    if (!permiso.ok) return jsonResponse(permiso.status, { error: permiso.error })

    // ── 4) Crear ──
    const resultado = await crearProfesores(supabase, { profesores, colegioId: permiso.colegioId })
    return jsonResponse(200, { ok: true, ...resultado })

  } catch (error) {
    return jsonResponse(500, { error: 'server_error', details: String(error) })
  }
})