-- =====================================================================
--  BOIT · Catálogo de AGENTES DE IA y AUTOMATIZACIÓN (14 productos nuevos)
--  Aparecen de PRIMEROS en el portal (destacado + orden 1..14).
--  Idempotente: ON CONFLICT por slug. No pisa el precio ya cotizado.
--  Además asigna un ícono (emoji) a los 20 productos anteriores.
-- =====================================================================

INSERT INTO servicio (slug, nombre, categoria, resumen, incluye, precio_desde_usd, dias_entrega, icono, destacado, orden)
VALUES

('chatbot-inteligente', 'Chatbot Inteligente', 'chatbots',
 'Asistente entrenado con la información de su empresa para responder preguntas de clientes 24/7, en lenguaje natural y con contexto propio.',
 '["Entrenado con la información de su empresa","Atención 24/7 en lenguaje natural","Base de conocimiento actualizable","Historial de conversaciones","Precisión estimada 95%"]'::jsonb,
 0, 7, '🤖', true, 1),

('chatbot-whatsapp', 'Chatbot para WhatsApp', 'chatbots',
 'Atención automática por WhatsApp Business: responde, envía catálogos, promociones y hace seguimiento sin intervención humana.',
 '["Integración con WhatsApp Business API","Mensajes automáticos y catálogos","Promociones, encuestas y recordatorios","Seguimiento de conversaciones","Precisión estimada 95%"]'::jsonb,
 0, 8, '💬', true, 2),

('chatbot-web', 'Chatbot para Página Web', 'chatbots',
 'Widget inteligente integrado a su sitio web que atiende visitantes, resuelve dudas y capta prospectos automáticamente.',
 '["Widget integrado a su sitio web","Atención y captación de prospectos","Personalización con su marca","Reportes y métricas","Precisión estimada 95%"]'::jsonb,
 0, 7, '🌐', true, 3),

('agente-comercial-ia', 'Agente Comercial IA', 'comercial',
 'Atiende clientes, califica prospectos y agenda reuniones automáticamente, integrado a su CRM y embudo de ventas.',
 '["Calificación automática de prospectos","Agenda de reuniones","Integración con CRM (HubSpot, Salesforce, Zoho, Bitrix24)","Seguimiento y recordatorios","Pronóstico de ventas","Precisión estimada 98%"]'::jsonb,
 0, 9, '💼', true, 4),

('multiagentes-comerciales', 'Multiagentes Comerciales', 'comercial',
 'Equipo de agentes especializados (ventas, soporte, facturación y seguimiento) trabajando de forma coordinada.',
 '["Agentes de ventas, soporte, facturación y seguimiento","Coordinación entre agentes","Automatización del embudo: de la captación a la posventa","Integración con CRM y pagos (Wompi, PayU, Stripe, Mercado Pago)","Métricas y reportes","Precisión estimada 98%"]'::jsonb,
 0, 10, '🧠', true, 5),

('call-center-ia', 'Call Center Digital IA', 'voz',
 'Recepción y realización automática de llamadas mediante voz con IA, con enrutamiento, transcripción y registro de cada caso.',
 '["Llamadas entrantes y salientes con voz IA","Enrutamiento inteligente","Transcripción y registro de llamadas","Integración telefónica","Precisión estimada 90%"]'::jsonb,
 0, 10, '☎️', true, 6),

('recepcionista-virtual', 'Recepcionista Virtual', 'voz',
 'Agenda citas, responde llamadas y envía recordatorios automáticos por voz y mensajería.',
 '["Agenda de citas","Respuesta de llamadas","Recordatorios automáticos","Integración con Google Calendar y Microsoft 365","Precisión estimada 95%"]'::jsonb,
 0, 8, '🛎️', true, 7),

('agente-servicio-cliente', 'Agente de Servicio al Cliente', 'voz',
 'Gestiona PQRS, garantías y seguimiento de casos de principio a fin, con trazabilidad completa.',
 '["Gestión de PQRS y garantías","Seguimiento de casos","Base de conocimiento","Escalamiento a agentes humanos","Precisión estimada 95%"]'::jsonb,
 0, 8, '🎧', true, 8),

('asistente-hoteles', 'Asistente para Hoteles', 'sectorial',
 'Reservas, disponibilidad, check-in/check-out y atención de huéspedes, tipo concierge digital 24/7.',
 '["Reservas y disponibilidad","Check-in y check-out","Atención al huésped y room service","Encuestas y fidelización","Precisión estimada 95%"]'::jsonb,
 0, 9, '🏨', true, 9),

('agente-restaurantes', 'Agente para Restaurantes', 'sectorial',
 'Reservas, domicilios y atención automática por WhatsApp y web para su restaurante.',
 '["Reservas y gestión de mesas","Pedidos a domicilio","Atención automática por WhatsApp","Catálogo y promociones","Precisión estimada 95%"]'::jsonb,
 0, 7, '🍽️', true, 10),

('agente-clinicas', 'Agente para Clínicas', 'sectorial',
 'Agenda consultas, confirma citas y responde preguntas frecuentes de los pacientes.',
 '["Agenda y confirmación de citas","Recordatorios a pacientes","Preguntas frecuentes","Integración con calendario","Precisión estimada 95%"]'::jsonb,
 0, 8, '🩺', true, 11),

('agente-inmobiliario', 'Agente Inmobiliario', 'sectorial',
 'Atiende compradores, filtra clientes según sus criterios y agenda visitas a inmuebles.',
 '["Atención y calificación de compradores","Filtro por criterios de búsqueda","Agenda de visitas","Integración con CRM","Precisión estimada 98%"]'::jsonb,
 0, 9, '🏡', true, 12),

('agente-juridico', 'Agente Jurídico', 'profesional',
 'Consulta documentos y normas y genera respuestas y borradores basados en la normatividad vigente.',
 '["Consulta de documentos y normas","Jurisprudencia y conceptos","Generación documental","Búsquedas inteligentes","Precisión estimada 90%"]'::jsonb,
 0, 10, '⚖️', true, 13),

('agente-contable', 'Agente Contable', 'profesional',
 'Responde consultas tributarias y genera reportes contables y financieros básicos.',
 '["Consultas tributarias","Reportes contables y financieros","Generación de informes","Integración con datos contables","Precisión estimada 90%"]'::jsonb,
 0, 10, '📊', true, 14),

('plataforma-crm-marketing', 'Plataforma de CRM, Email Marketing y SMS', 'plataformas',
 'CRM inteligente con email marketing y campañas automatizadas de SMS y WhatsApp: capte, clasifique, haga seguimiento y fidelice clientes desde un solo lugar.',
 '["Registro y clasificación de clientes con IA","Seguimiento, recordatorios y pronóstico de ventas","Email marketing: correos personalizados y segmentación","Campañas de SMS y WhatsApp con catálogos y promociones","Automatización del embudo y métricas","Integración con HubSpot, Salesforce, Zoho y Bitrix24"]'::jsonb,
 0, 10, '📇', true, 15),

('plataforma-rrhh', 'Plataforma de RRHH', 'plataformas',
 'Reclutador IA y asistente de talento humano: analiza hojas de vida, agenda entrevistas y automatiza certificados, vacaciones, inducción y consultas del personal.',
 '["Análisis y clasificación de hojas de vida","Agenda de entrevistas e informes de candidatos","Gestión de vacaciones y certificados","Inducción, manuales y consultas del personal","Reportes de talento humano"]'::jsonb,
 0, 9, '👥', true, 16),

('modulo-seo', 'Módulo de SEO integrado', 'plataformas',
 'SEO automático para su plataforma empresarial: investigación de palabras clave, optimización, auditorías y generación de contenido posicionado.',
 '["Investigación de palabras clave","Optimización y metaetiquetas","Auditorías SEO","Generación de contenido SEO (blogs y landing pages)","Reportes de posicionamiento"]'::jsonb,
 0, 8, '🔍', true, 17)

ON CONFLICT (slug) DO UPDATE SET
  nombre       = EXCLUDED.nombre,
  categoria    = EXCLUDED.categoria,
  resumen      = EXCLUDED.resumen,
  incluye      = EXCLUDED.incluye,
  dias_entrega = EXCLUDED.dias_entrega,
  icono        = EXCLUDED.icono,
  destacado    = EXCLUDED.destacado,
  orden        = EXCLUDED.orden;

-- ---------------------------------------------------------------------
--  Íconos (emoji) para los 20 productos anteriores. Solo el ícono:
--  no toca días, precios ni orden.
-- ---------------------------------------------------------------------
UPDATE servicio SET icono = '🔬' WHERE slug = 'proyecto-investigacion';
UPDATE servicio SET icono = '🚀' WHERE slug = 'proyecto-emprendimiento';
UPDATE servicio SET icono = '🎭' WHERE slug = 'proyecto-cultural';
UPDATE servicio SET icono = '🤲' WHERE slug = 'proyecto-social';
UPDATE servicio SET icono = '🌱' WHERE slug = 'proyecto-ambiental';
UPDATE servicio SET icono = '💧' WHERE slug = 'recursos-hidricos';
UPDATE servicio SET icono = '📈' WHERE slug = 'modelo-de-negocio';
UPDATE servicio SET icono = '🔎' WHERE slug = 'estudio-de-mercado';
UPDATE servicio SET icono = '⚠️' WHERE slug = 'analisis-de-riesgo';
UPDATE servicio SET icono = '🧾' WHERE slug = 'documento-contable';
UPDATE servicio SET icono = '📜' WHERE slug = 'documento-juridico';
UPDATE servicio SET icono = '💻' WHERE slug = 'desarrollo-a-la-medida';
UPDATE servicio SET icono = '🎯' WHERE slug = 'proyectos-estrategicos';
UPDATE servicio SET icono = '🎨' WHERE slug = 'design-thinking';
UPDATE servicio SET icono = '✉️' WHERE slug = 'sms-correo-apis';
UPDATE servicio SET icono = '🗄️' WHERE slug = 'procesamiento-datos';
UPDATE servicio SET icono = '📡' WHERE slug = 'internet-de-las-cosas';
UPDATE servicio SET icono = '🎓' WHERE slug = 'capacitaciones-talleres';
UPDATE servicio SET icono = '🏢' WHERE slug = 'automatizacion-edificios';
UPDATE servicio SET icono = '📦' WHERE slug = 'suministro-insumos';
