-- =====================================================================
--  BOIT · Servicios de la página "servicios.html" añadidos al catálogo
--  Idempotente (ON CONFLICT por slug). No pisa precios editados.
-- =====================================================================

INSERT INTO servicio (slug, nombre, categoria, resumen, incluye, precio_desde_usd, dias_entrega, icono, destacado, orden)
VALUES
('desarrollo-a-la-medida', 'Desarrollo de herramientas tecnológicas a la medida', 'desarrollo',
 'Software y hardware de última generación: aplicaciones web, móviles y plataformas que digitalizan y transforman su operación.',
 '["Aplicaciones web y móviles multiplataforma","Plataformas a la medida e integraciones","Soluciones de software y hardware","Acompañamiento y puesta en marcha"]'::jsonb,
 0, 30, 'codigo', true, 120),

('proyectos-estrategicos', 'Formulación y ejecución de proyectos estratégicos', 'estrategico',
 'Formulamos y ejecutamos proyectos en ambiente, educación, salud y agroindustria, mediados por tecnologías de la 4ta revolución industrial.',
 '["Estructuración técnica y de impacto","Ejecución y acompañamiento integral","Enfoque sostenible y territorial","Indicadores y seguimiento"]'::jsonb,
 0, 25, 'estrategia', true, 130),

('design-thinking', 'Design + Thinking', 'diseno',
 'Diseñamos plataformas y servicios centrados en el usuario, integrando marca, tendencias globales e inteligencia competitiva.',
 '["Investigación y experiencia de usuario (UX/UI)","Diseño responsivo y de marca","Prototipado e innovación","Inteligencia competitiva"]'::jsonb,
 0, 20, 'diseno', false, 140),

('sms-correo-apis', 'Gestión de SMS, correo electrónico e integración de APIs', 'integracion',
 'Aplicaciones para gestionar información y mensajería de forma óptima, con campañas relevantes e integración de APIs.',
 '["Campañas de SMS y correo electrónico","Integración de APIs y automatizaciones","Mensajería promocional y transaccional","Reportes de entrega"]'::jsonb,
 0, 15, 'mensajeria', false, 150),

('procesamiento-datos', 'Procesamiento y análisis de sistemas digitales', 'datos',
 'Desarrollo y adquisición de sistemas y datos digitales, integrados a plataformas educativas, ambientales y productivas.',
 '["Procesamiento de información estratégica","Análisis de datos y sistemas","Integración a plataformas existentes","Tableros de visualización"]'::jsonb,
 0, 20, 'datos', false, 160),

('internet-de-las-cosas', 'Internet de las Cosas (IoT)', 'iot',
 'Sensores y dispositivos conectados para monitorear variables y tomar decisiones en tiempo real en campo, ciudad e industria.',
 '["Redes de sensores y dispositivos","Monitoreo y telemetría en tiempo real","Tableros y alertas inteligentes","Instalación y soporte"]'::jsonb,
 0, 30, 'iot', true, 170),

('capacitaciones-talleres', 'Capacitaciones y talleres', 'formacion',
 'Formamos equipos y comunidades en tecnología, innovación y transformación digital, con talleres prácticos y a la medida.',
 '["Programas a la medida por sector","Talleres prácticos y mentoría","Alfabetización digital","Certificación de participación"]'::jsonb,
 0, 12, 'formacion', false, 180),

('automatizacion-edificios', 'Automatización inteligente de edificios', 'domotica',
 'Domótica e IoT para edificios e instalaciones: eficiencia energética, seguridad y control centralizado de sistemas.',
 '["Domótica, sensores y control central","Eficiencia energética y ahorro","Seguridad, accesos y monitoreo","Diseño e implementación"]'::jsonb,
 0, 35, 'edificio', false, 190),

('suministro-insumos', 'Suministro de insumos y herramientas', 'suministro',
 'Insumos y herramientas para proyectos de agroindustria, educación y medio ambiente, con acompañamiento técnico.',
 '["Equipos e insumos para agro","Material y dotación para educación","Soluciones para gestión ambiental","Acompañamiento técnico"]'::jsonb,
 0, 15, 'suministro', false, 200)

ON CONFLICT (slug) DO UPDATE SET
  nombre       = EXCLUDED.nombre,
  categoria    = EXCLUDED.categoria,
  resumen      = EXCLUDED.resumen,
  incluye      = EXCLUDED.incluye,
  dias_entrega = EXCLUDED.dias_entrega,
  icono        = EXCLUDED.icono,
  destacado    = EXCLUDED.destacado,
  orden        = EXCLUDED.orden;
