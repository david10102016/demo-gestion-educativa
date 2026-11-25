-- ============================================================
-- MIGRACIÓN 005: DATOS INICIALES
-- Colegio placeholder, cursos, materias, configuración 2026
-- ============================================================

-- -------------------------------------------------------
-- COLEGIO (placeholder — el director lo edita en configuraciones)
-- -------------------------------------------------------
INSERT INTO public.colegios (id, nombre, municipio, departamento)
VALUES ('00000000-0000-0000-0000-000000000001', 'Mi Institución Educativa', 'Santa Cruz de la Sierra', 'Santa Cruz');

-- -------------------------------------------------------
-- CURSOS: Primaria y Secundaria, grados 1-6, paralelos A/B/C
-- -------------------------------------------------------
INSERT INTO public.cursos (colegio_id, nivel, grado, paralelo) VALUES
  -- Primaria
  ('00000000-0000-0000-0000-000000000001','Primaria',1,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',1,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',1,'C'),
  ('00000000-0000-0000-0000-000000000001','Primaria',2,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',2,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',2,'C'),
  ('00000000-0000-0000-0000-000000000001','Primaria',3,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',3,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',3,'C'),
  ('00000000-0000-0000-0000-000000000001','Primaria',4,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',4,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',4,'C'),
  ('00000000-0000-0000-0000-000000000001','Primaria',5,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',5,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',5,'C'),
  ('00000000-0000-0000-0000-000000000001','Primaria',6,'A'),
  ('00000000-0000-0000-0000-000000000001','Primaria',6,'B'),
  ('00000000-0000-0000-0000-000000000001','Primaria',6,'C'),
  -- Secundaria
  ('00000000-0000-0000-0000-000000000001','Secundaria',1,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',1,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',1,'C'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',2,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',2,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',2,'C'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',3,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',3,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',3,'C'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',4,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',4,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',4,'C'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',5,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',5,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',5,'C'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',6,'A'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',6,'B'),
  ('00000000-0000-0000-0000-000000000001','Secundaria',6,'C');

-- -------------------------------------------------------
-- MATERIAS: Primaria
-- -------------------------------------------------------
INSERT INTO public.materias (colegio_id, nombre, nivel, campo_saberes, es_tecnica) VALUES
  ('00000000-0000-0000-0000-000000000001','Comunicación y Lenguajes','Primaria','COMUNIDAD Y SOCIEDAD',false),
  ('00000000-0000-0000-0000-000000000001','Ciencias Sociales','Primaria','COMUNIDAD Y SOCIEDAD',false),
  ('00000000-0000-0000-0000-000000000001','Educación Física y Deportes','Primaria','COMUNIDAD Y SOCIEDAD',false),
  ('00000000-0000-0000-0000-000000000001','Educación Musical','Primaria','COMUNIDAD Y SOCIEDAD',false),
  ('00000000-0000-0000-0000-000000000001','Artes Plásticas y Visuales','Primaria','COMUNIDAD Y SOCIEDAD',false),
  ('00000000-0000-0000-0000-000000000001','Matemática','Primaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',false),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica','Primaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',false),
  ('00000000-0000-0000-0000-000000000001','Ciencias Naturales','Primaria','VIDA TIERRA TERRITORIO',false),
  ('00000000-0000-0000-0000-000000000001','Valores, Espiritualidad y Religiones','Primaria','COSMOS Y PENSAMIENTO',false);

-- -------------------------------------------------------
-- MATERIAS: Secundaria
-- -------------------------------------------------------
INSERT INTO public.materias (colegio_id, nombre, nivel, campo_saberes, es_tecnica, aplica_desde) VALUES
  ('00000000-0000-0000-0000-000000000001','Comunicación y Lenguajes: Lengua Castellana y Originaria','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Lengua Extranjera','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Ciencias Sociales','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Educación Física y Deportes','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Educación Musical','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Artes Plásticas y Visuales','Secundaria','COMUNIDAD Y SOCIEDAD',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Matemática','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica General','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica - Sistemas Informáticos','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',true,'4to'),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica - Gastronomía','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',true,'4to'),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica - Construcción Civil','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',true,'4to'),
  ('00000000-0000-0000-0000-000000000001','Técnica Tecnológica - Mecánica Automotriz','Secundaria','CIENCIA TECNOLOGÍA Y PRODUCCIÓN',true,'4to'),
  ('00000000-0000-0000-0000-000000000001','Ciencias Naturales: Biología - Geografía','Secundaria','VIDA TIERRA TERRITORIO',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Ciencias Naturales: Física','Secundaria','VIDA TIERRA TERRITORIO',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Ciencias Naturales: Química','Secundaria','VIDA TIERRA TERRITORIO',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Cosmovisiones, Filosofía y Sicología','Secundaria','COSMOS Y PENSAMIENTO',false,NULL),
  ('00000000-0000-0000-0000-000000000001','Valores, Espiritualidad y Religiones','Secundaria','COSMOS Y PENSAMIENTO',false,NULL);

-- -------------------------------------------------------
-- GESTIÓN 2026
-- -------------------------------------------------------
INSERT INTO public.config_gestion
  (año, estado, cantidad_periodos, nombre_periodo, nota_minima_aprobacion, escala_maxima, etiqueta_aprobado, etiqueta_reprobado)
VALUES
  (2026, 'activo', 3, 'Trimestre', 51, 100, 'APROBADO', 'REPROBADO');

-- -------------------------------------------------------
-- DIMENSIONES 2026
-- -------------------------------------------------------
WITH g AS (SELECT id FROM public.config_gestion WHERE año = 2026)
INSERT INTO public.config_dimensiones (gestion_id, año, codigo, nombre_display, peso_maximo, tipo, orden)
SELECT g.id, 2026, v.codigo, v.nombre, v.peso, v.tipo, v.orden
FROM g, (VALUES
  ('hacer',  'HACER',   40, 'actividades', 1),
  ('saber',  'SABER',   45, 'actividades', 2),
  ('ser',    'SER',     10, 'ficha',       3),
  ('decidir','DECIDIR',  5, 'directo',     4)
) AS v(codigo, nombre, peso, tipo, orden);

-- -------------------------------------------------------
-- CATEGORÍAS SER 2026
-- -------------------------------------------------------
INSERT INTO public.config_categorias_ser (año, nombre, orden) VALUES
  (2026, 'RESPONSABILIDAD', 1),
  (2026, 'PARTICIPACIÓN',   2),
  (2026, 'SOLIDARIDAD',     3),
  (2026, 'RESPETO',         4),
  (2026, 'PUNTUALIDAD',     5);

-- -------------------------------------------------------
-- SUBCRITERIOS SER 2026 (CORREGIDO)
-- -------------------------------------------------------
WITH cats AS (
  SELECT id, nombre FROM public.config_categorias_ser WHERE año = 2026
)
INSERT INTO public.config_subcriterios_ser (categoria_id, año, texto, descripcion, orden)
SELECT c.id, 2026, v.texto, v.descripcion, v.orden
FROM cats c
JOIN (VALUES
  ('RESPONSABILIDAD','Entrega tareas a tiempo',         'Cumple con los plazos establecidos para entrega de trabajos',       1),
  ('RESPONSABILIDAD','Cumple normas del aula',          'Respeta las reglas de convivencia establecidas en el aula',         2),
  ('PARTICIPACIÓN',  'Contribuye activamente en clase', 'Aporta ideas y participa en discusiones grupales',                 1),
  ('PARTICIPACIÓN',  'Realiza preguntas pertinentes',   'Muestra curiosidad e interés con preguntas adecuadas al tema',     2),
  ('SOLIDARIDAD',    'Apoya a sus compañeros',          'Ayuda a otros estudiantes cuando lo necesitan',                    1),
  ('SOLIDARIDAD',    'Trabaja bien en equipo',          'Colabora efectivamente en trabajos y proyectos grupales',          2),
  ('RESPETO',        'Trata bien a sus compañeros',     'Mantiene relaciones cordiales y respetuosas con sus pares',        1),
  ('RESPETO',        'Respeta al docente',              'Muestra consideración y respeto hacia la autoridad académica',     2),
  ('PUNTUALIDAD',    'Llega a tiempo a clases',         'Asiste puntualmente al inicio de cada sesión de clase',           1),
  ('PUNTUALIDAD',    'Asiste regularmente',             'Mantiene asistencia consistente sin faltas injustificadas',        2)
) AS v(cat, texto, descripcion, orden) ON c.nombre = v.cat;

-- -------------------------------------------------------
-- ESCALA SER 2026
-- -------------------------------------------------------
INSERT INTO public.config_escala_ser (año, valor_numerico, etiqueta, color, orden) VALUES
  (2026, 10, 'Siempre',      'green',  1),
  (2026,  7, 'Casi Siempre', 'yellow', 2),
  (2026,  2, 'Nunca',        'red',    3);

-- -------------------------------------------------------
-- PREGUNTAS EVALUACIÓN DOCENTE 2026
-- -------------------------------------------------------
INSERT INTO public.config_preguntas_docente (año, texto, escala_min, escala_max, orden) VALUES
  (2026, 'El docente explica los temas con claridad y orden',        1, 4, 1),
  (2026, 'El docente demuestra dominio y conocimiento del tema',     1, 4, 2),
  (2026, 'El docente trata a los estudiantes con respeto',           1, 4, 3),
  (2026, 'El docente cumple con el horario de clases puntualmente',  1, 4, 4),
  (2026, 'El docente evalúa de forma justa y equitativa',           1, 4, 5),
  (2026, 'El docente incentiva la participación en clase',           1, 4, 6),
  (2026, 'El docente usa recursos y materiales adecuados',           1, 4, 7),
  (2026, 'Recomendarías a este docente a otros estudiantes',         1, 4, 8);

-- -------------------------------------------------------
-- PLANTILLAS TELEGRAM
-- -------------------------------------------------------
INSERT INTO public.config_notificaciones (tipo, nombre_display, plantilla, umbral_faltas) VALUES
  ('nueva_actividad',
   'Nueva actividad publicada',
   E'¡Hola {nombre}! 📚\n\nSe publicó una nueva actividad:\n📝 {actividad_titulo}\n📅 Fecha límite: {fecha_limite}\n🎯 Puntos: {max_puntos}\n\n¡No olvides completarla a tiempo!',
   NULL),
  ('nota_registrada',
   'Nota registrada',
   E'Hola {nombre},\n\nTu nota para "{actividad_titulo}" fue registrada:\n📊 Calificación: {nota_valor} / {max_puntos}\n\n¡Sigue adelante! 💪',
   NULL),
  ('faltas_alerta',
   'Alerta de inasistencias',
   E'⚠️ ALERTA DE ASISTENCIA\n\nEstimado tutor/a de {nombre}:\n\nSe han registrado {faltas} falta(s) en los últimos 30 días.\n\nLa asistencia regular es fundamental para el aprendizaje.',
   3),
  ('ficha_publicada',
   'Ficha SER publicada',
   E'Hola {nombre},\n\nTu evaluación SER de {materia} - {periodo} {numero_periodo} fue publicada.\n📋 Nota SER: {nota_ser} / {max_ser}\n\nConsulta el detalle en el sistema.',
   NULL);