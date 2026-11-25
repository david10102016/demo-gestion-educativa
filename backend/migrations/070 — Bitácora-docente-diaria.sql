-- ============================================================
-- MIGRACIÓN 070 — Bitácora docente diaria
--
-- Objetivo: tabla nueva para que el profesor registre, por día,
-- qué tema dictó en cada curso/materia que tiene asignado. El
-- director ve el registro de todo su colegio y puede comentar
-- (observacion_director), sin poder reescribir el contenido del
-- profesor. No es obligatorio, no bloquea ningún otro flujo.
--
-- Objetos nuevos: tabla public.bitacora_docente, 5 policies RLS,
-- función + trigger public.proteger_bitacora_columnas_director().
-- No modifica ninguna tabla, función ni policy existente.
--
-- Depende de (ya verificado en vivo, todas existen):
--   public.es_profesor(), public.es_director(), public.es_superadmin(),
--   public.mi_colegio_id(), public.profesor_asignado_curso(uuid)
--
-- Aislamiento multitenant (fix aplicado antes de aplicar en prod):
--   bitacora_insert_profesor originalmente no exigía
--   colegio_id = mi_colegio_id() -- un INSERT armado a mano (fuera
--   del panel) podía guardar un colegio_id ajeno y aparecer en el
--   panel de otro director. bitacora_update_profesor originalmente
--   solo exigía profesor_id = auth.uid() sin WITH CHECK explícito
--   (Postgres reusa el USING como WITH CHECK cuando no se declara
--   uno), permitiendo reescribir curso_id/materia_id/colegio_id de
--   una fila propia sin revalidar la asignación real. Ambas quedan
--   corregidas abajo: INSERT con colegio_id = mi_colegio_id(), y
--   UPDATE con el mismo WITH CHECK completo que el INSERT.
--
-- No requiere ningún cambio en frontend: bitacora.js ya envía
-- colegio_id: _perfil.colegio_id real, y curso_id/materia_id ya
-- salen únicamente de las asignaciones reales del profesor.
-- ============================================================

CREATE TABLE public.bitacora_docente (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  colegio_id            uuid NOT NULL REFERENCES public.colegios(id),
  profesor_id           uuid NOT NULL REFERENCES public.usuarios(id),
  curso_id              uuid NOT NULL REFERENCES public.cursos(id),
  materia_id            uuid NOT NULL REFERENCES public.materias(id),
  fecha                 date NOT NULL,
  tema                  text NOT NULL,
  tipo_actividad        text NOT NULL,
  estado                text NOT NULL DEFAULT 'culminado'
                        CHECK (estado IN ('culminado', 'pendiente')),
  detalle               text,
  observacion_director  text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profesor_id, curso_id, materia_id, fecha)
);

ALTER TABLE public.bitacora_docente ENABLE ROW LEVEL SECURITY;

-- Profesor: solo sus propios registros.
CREATE POLICY bitacora_select_profesor ON public.bitacora_docente
FOR SELECT USING (profesor_id = auth.uid());

-- INSERT: asignación real (curso + materia + activo) más colegio_id
-- verificado contra la sesión, no confiado del payload.
CREATE POLICY bitacora_insert_profesor ON public.bitacora_docente
FOR INSERT WITH CHECK (
  public.es_profesor()
  AND profesor_id = auth.uid()
  AND public.profesor_asignado_curso(curso_id)
  AND EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    WHERE ap.profesor_id = auth.uid() AND ap.curso_id = bitacora_docente.curso_id
      AND ap.materia_id = bitacora_docente.materia_id AND ap.activo = true
  )
  AND colegio_id = public.mi_colegio_id()
);

-- UPDATE: mismo nivel de revalidación que el INSERT en el WITH CHECK,
-- no solo "soy el dueño de la fila".
CREATE POLICY bitacora_update_profesor ON public.bitacora_docente
FOR UPDATE USING (profesor_id = auth.uid())
WITH CHECK (
  profesor_id = auth.uid()
  AND public.profesor_asignado_curso(curso_id)
  AND EXISTS (
    SELECT 1 FROM public.asignaciones_profesor ap
    WHERE ap.profesor_id = auth.uid() AND ap.curso_id = bitacora_docente.curso_id
      AND ap.materia_id = bitacora_docente.materia_id AND ap.activo = true
  )
  AND colegio_id = public.mi_colegio_id()
);

-- Director: lee todo su colegio, y puede escribir la observación --
-- el trigger de abajo garantiza que no pueda tocar ningún otro campo.
CREATE POLICY bitacora_select_director ON public.bitacora_docente
FOR SELECT USING (public.es_director() AND colegio_id = public.mi_colegio_id());

CREATE POLICY bitacora_update_director ON public.bitacora_docente
FOR UPDATE USING (public.es_director() AND colegio_id = public.mi_colegio_id());

-- ------------------------------------------------------------
-- Trigger: el director SOLO puede cambiar observacion_director.
-- RLS no distingue por columna -- mismo patrón que
-- proteger_colegio_tutor() / proteger_plan_colegio().
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.proteger_bitacora_columnas_director()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF public.es_director() AND NOT public.es_profesor() THEN
    IF NEW.tema IS DISTINCT FROM OLD.tema
       OR NEW.tipo_actividad IS DISTINCT FROM OLD.tipo_actividad
       OR NEW.estado IS DISTINCT FROM OLD.estado
       OR NEW.detalle IS DISTINCT FROM OLD.detalle
       OR NEW.curso_id IS DISTINCT FROM OLD.curso_id
       OR NEW.materia_id IS DISTINCT FROM OLD.materia_id
       OR NEW.fecha IS DISTINCT FROM OLD.fecha
       OR NEW.profesor_id IS DISTINCT FROM OLD.profesor_id
    THEN
      RAISE EXCEPTION 'El director solo puede editar la observación, no el contenido registrado por el profesor';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_bitacora_columnas_director ON public.bitacora_docente;
CREATE TRIGGER trg_proteger_bitacora_columnas_director
  BEFORE UPDATE ON public.bitacora_docente
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_bitacora_columnas_director();

-- ─────────────────────────────────────────────────────────
-- Verificación post-migración:
--
-- 1. select table_name from information_schema.tables
--    where table_name = 'bitacora_docente'; -> debe existir.
--
-- 2. Profesor inserta registro de hoy en su propio curso/materia
--    asignada, con su colegio_id real -> 201.
--
-- 3. Profesor intenta insertar con un colegio_id que no es el suyo
--    (payload manual, no vía panel) -> 403
--    (bloqueado por colegio_id = mi_colegio_id()).
--
-- 4. Profesor intenta UPDATE de una fila propia cambiando curso_id
--    a uno donde NO tiene asignación activa -> 403
--    (bloqueado por el WITH CHECK nuevo del UPDATE).
--
-- 5. Director cambia `tema` de un registro de su colegio -> rechaza
--    con la excepción del trigger.
--
-- 6. Director cambia solo `observacion_director` -> 200, permitido.
-- ─────────────────────────────────────────────────────────