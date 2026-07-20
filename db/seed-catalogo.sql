-- =====================================================================
--  BOIT · Catálogo inicial de servicios
--  Idempotente: se puede correr varias veces (ON CONFLICT por slug).
--  Los precios son "desde USD" y se pueden editar luego desde el tablero.
-- =====================================================================

INSERT INTO servicio (slug, nombre, categoria, resumen, incluye, precio_desde_usd, dias_entrega, icono, destacado, orden)
VALUES
-- ---------- Desarrollo colaborativo de proyectos ----------
('proyecto-investigacion', 'Proyecto de investigación', 'investigacion',
 'Estructuración completa para convocatorias públicas y privadas: problema, estado del arte, metodología, presupuesto, cronograma e indicadores.',
 '["Documento maestro del proyecto","Marco lógico e indicadores","Presupuesto y cronograma","Anexos y documentos soporte"]'::jsonb,
 1800, 15, 'microscopio', true, 10),

('proyecto-emprendimiento', 'Proyecto de emprendimiento', 'emprendimiento',
 'Acompañamiento de punta a punta: de la idea de negocio a su validación, estructuración y lanzamiento al mercado.',
 '["Validación de la idea","Modelo de negocio","Plan de lanzamiento","Proyección financiera"]'::jsonb,
 1500, 14, 'cohete', true, 20),

('proyecto-cultural', 'Proyecto cultural', 'cultural',
 'Formulación de iniciativas culturales y de patrimonio, listas para convocatorias de estímulos y cooperación.',
 '["Documento de formulación","Justificación y pertinencia","Presupuesto y cronograma","Plan de circulación"]'::jsonb,
 1200, 12, 'paleta', false, 30),

('proyecto-social', 'Proyecto social', 'social',
 'Proyectos de impacto social con enfoque territorial y diferencial, con línea base e indicadores medibles.',
 '["Diagnóstico y línea base","Marco lógico","Indicadores de impacto","Presupuesto y cronograma"]'::jsonb,
 1200, 12, 'comunidad', false, 40),

('proyecto-ambiental', 'Proyecto ambiental', 'ambiental',
 'Formulación ambiental con soporte técnico y normativo, para entidades públicas, privadas y cooperación.',
 '["Diagnóstico ambiental","Marco normativo aplicable","Plan de manejo","Presupuesto y cronograma"]'::jsonb,
 1600, 15, 'hoja', true, 50),

('recursos-hidricos', 'Proyecto de recursos hídricos', 'hidrico',
 'Estudios y formulación en gestión del agua: cuencas, abastecimiento, saneamiento y adaptación climática.',
 '["Caracterización del recurso","Análisis técnico","Alternativas de intervención","Presupuesto y cronograma"]'::jsonb,
 2000, 18, 'agua', true, 60),

-- ---------- Documentos técnicos y de negocio ----------
('modelo-de-negocio', 'Modelo de negocio', 'negocio',
 'Documento completo de modelo de negocio con propuesta de valor, operación, estructura de costos y proyección.',
 '["Propuesta de valor","Modelo operativo","Estructura de costos e ingresos","Proyección financiera a 3 años"]'::jsonb,
 1400, 12, 'lienzo', true, 70),

('estudio-de-mercado', 'Estudio de mercado', 'mercado',
 'Investigación de mercado con tamaño, segmentación, competencia, precios y recomendaciones accionables.',
 '["Tamaño y segmentación","Análisis de competencia","Estrategia de precios","Conclusiones y recomendaciones"]'::jsonb,
 1300, 12, 'grafico', false, 80),

('analisis-de-riesgo', 'Análisis de riesgo', 'riesgo',
 'Identificación, valoración y plan de tratamiento de riesgos con matriz y controles.',
 '["Matriz de riesgos","Valoración e impacto","Plan de tratamiento","Indicadores de seguimiento"]'::jsonb,
 1100, 10, 'escudo', false, 90),

('documento-contable', 'Documento contable y financiero', 'contable',
 'Informes financieros, estructuras de costos y soportes contables para proyectos y convocatorias.',
 '["Estructura de costos","Estados e informes","Soportes contables","Notas explicativas"]'::jsonb,
 900, 8, 'calculadora', false, 100),

('documento-juridico', 'Documento jurídico', 'juridico',
 'Conceptos, minutas y soportes jurídicos para la ejecución de proyectos y relaciones contractuales.',
 '["Concepto jurídico","Minutas y anexos","Revisión normativa","Recomendaciones"]'::jsonb,
 950, 8, 'balanza', false, 110)

ON CONFLICT (slug) DO UPDATE SET
  nombre           = EXCLUDED.nombre,
  categoria        = EXCLUDED.categoria,
  resumen          = EXCLUDED.resumen,
  incluye          = EXCLUDED.incluye,
  dias_entrega     = EXCLUDED.dias_entrega,
  icono            = EXCLUDED.icono,
  destacado        = EXCLUDED.destacado,
  orden            = EXCLUDED.orden;
-- Nota: el precio NO se sobrescribe, para no pisar ajustes hechos desde el tablero.
