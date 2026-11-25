// js/licencias/permisos.js
// Pantalla del director: casillas de permisos para la secretaria y el regente.
// Cada casilla se guarda en permisos_usuario y la base la controla con RLS (tiene_permiso()).
// Para agregar permisos en el futuro: sumarlos aquí y en el CHECK de permisos_usuario (nueva migración).
import { supabase } from '../config/supabase-config.js'
import { toast } from '../utils/ui.js'
import { escapeHtml as esc } from '../utils/sanitize.js'

export const PERMISOS = [
  { clave: 'licencias.aprobar', titulo: 'Aprobar o rechazar licencias', detalle: 'Ve las solicitudes de los tutores y sus comprobantes.' },
  { clave: 'vinculos.revisar',  titulo: 'Revisar vinculaciones de tutores', detalle: 'Ve el carnet de los tutores y marca Revisado o Rechazado.' },
]

export async function montarPermisos(box, colegioId) {
  box.innerHTML = `<p style="color:var(--color-text-secondary);">Cargando…</p>`
  const [{ data: personas, error }, { data: actuales }] = await Promise.all([
    supabase.from('usuarios').select('id, nombre_completo, rol').eq('colegio_id', colegioId)
      .in('rol', ['secretaria', 'regente']).eq('activo', true).order('rol').order('nombre_completo'),
    supabase.from('permisos_usuario').select('usuario_id, permiso').eq('colegio_id', colegioId),
  ])
  if (error) { box.innerHTML = `<div class="card">${esc(error.message)}</div>`; return }
  if (!personas?.length) {
    box.innerHTML = `<div class="card" style="text-align:center;color:var(--color-text-secondary);">No hay secretaria ni regente activos en el colegio.</div>`
    return
  }
  const tiene = (u, p) => (actuales ?? []).some(a => a.usuario_id === u && a.permiso === p)
  const { data: { user } } = await supabase.auth.getUser()

  box.innerHTML = `<p style="font-size:0.85rem;color:var(--color-text-secondary);margin:0 0 12px;">
      Marca lo que cada persona puede hacer. El cambio es inmediato (la persona debe recargar su panel). Tú, como director, siempre tienes todos los permisos.</p>` +
    personas.map(u => `
      <div class="card" style="margin-bottom:10px;padding:14px 16px;">
        <div style="font-weight:700;margin-bottom:8px;">${esc(u.nombre_completo)} <span class="badge badge-neutral">${u.rol === 'secretaria' ? 'Secretaria' : 'Regente'}</span></div>
        ${PERMISOS.map(p => `
          <label style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;cursor:pointer;">
            <input type="checkbox" data-u="${u.id}" data-p="${p.clave}" ${tiene(u.id, p.clave) ? 'checked' : ''} style="margin-top:3px;width:18px;height:18px;">
            <span><b style="font-size:0.9rem;">${p.titulo}</b><br><small style="color:var(--color-text-3);">${p.detalle}</small></span>
          </label>`).join('')}
      </div>`).join('')

  box.querySelectorAll('input[type=checkbox][data-u]').forEach(chk => chk.addEventListener('change', async () => {
    chk.disabled = true
    const { u, p } = chk.dataset
    const { error } = chk.checked
      ? await supabase.from('permisos_usuario').insert({ usuario_id: u, colegio_id: colegioId, permiso: p, otorgado_por: user?.id })
      : await supabase.from('permisos_usuario').delete().eq('usuario_id', u).eq('permiso', p)
    chk.disabled = false
    if (error) { chk.checked = !chk.checked; toast(error.message, 'error') }
    else toast(chk.checked ? 'Permiso otorgado' : 'Permiso quitado', 'success')
  }))
}
