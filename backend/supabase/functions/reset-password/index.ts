import { serve } from "https://deno.land/std@0.201.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '')

    if (!token) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Cliente con ANON key, solo para validar el token de quien llama
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    )

    const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token)
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Cliente con SERVICE_ROLE, para las operaciones privilegiadas
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Verificar que quien llama es director o superadmin, activo
    const { data: llamante, error: errLlamante } = await supabase
      .from('usuarios')
      .select('rol, activo, colegio_id')
      .eq('id', userData.user.id)
      .single()

    if (errLlamante || !llamante || !llamante.activo ||
        !['director', 'superadmin'].includes(llamante.rol)) {
      return new Response(JSON.stringify({ error: 'Sin permisos' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { usuario_id, nueva_password } = await req.json()

    if (!usuario_id || !nueva_password) {
      return new Response(JSON.stringify({ error: 'usuario_id y nueva_password son requeridos' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Si es director (no superadmin), solo puede resetear usuarios de su propio colegio
    if (llamante.rol === 'director') {
      const { data: objetivo } = await supabase
        .from('usuarios')
        .select('colegio_id')
        .eq('id', usuario_id)
        .single()

      if (!objetivo || objetivo.colegio_id !== llamante.colegio_id) {
        return new Response(JSON.stringify({ error: 'Sin permisos sobre ese usuario' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }
    }

    const { error } = await supabase.rpc('update_user_password', {
      p_user_id: usuario_id,
      p_password: nueva_password
    })

    if (error) throw error

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})