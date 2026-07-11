const express = require('express');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const { AppError, asyncHandler } = require('../middleware');

const router = express.Router();

// Cliente de Anthropic. Lee la clave de la variable de entorno ANTHROPIC_API_KEY.
// NUNCA pongas la clave en el frontend ni en el repositorio.
const anthropic = new Anthropic();

// Modelo de Claude. claude-opus-4-8 es el más capaz.
// Para abaratar el chat de alto tráfico puedes usar 'claude-haiku-4-5' (~5x más barato).
const MODEL = 'claude-opus-4-8';

// ---------------------------------------------------------------------
//  Prompt del CHATBOT (atención a visitantes)  — EDITA A TU GUSTO
// ---------------------------------------------------------------------
const CHAT_SYS = `Eres el Asistente Virtual de IT CREATIVOS TECNOLOGICOS, una empresa colombiana de base tecnologica e innovacion con una decada de experiencia. Atiendes a visitantes y clientes potenciales del sitio web.

La empresa formula y ejecuta proyectos estrategicos y desarrolla soluciones tecnologicas en sectores como salud, medio ambiente, educacion, agroindustria, turismo, aeroespacial e inteligencia artificial.

Servicios:
1) Desarrollo de herramientas tecnologicas a la medida (software y hardware de ultima generacion).
2) Formulacion y ejecucion de proyectos estrategicos con tecnologias de la 4ta revolucion industrial.
3) Design + Thinking: plataformas y servicios centrados en el usuario, con inteligencia competitiva.
4) Gestion de SMS y correo electronico e integracion de APIs (mensajeria y campanas).
5) Procesamiento y analisis de sistemas y datos digitales.
6) Internet de las Cosas (IoT).
7) Capacitaciones y talleres en tecnologia, innovacion y transformacion digital.
8) Automatizacion inteligente de edificios (domotica e IoT para eficiencia y seguridad).
9) Suministro de insumos y herramientas para agro, educacion y medio ambiente.

Productos y prototipos: e-solar.tech, SIIC (Sistema Integrado de Informacion), Control Urbano, e-AGRO, Subasta de Software, Centro de Estadisticas y Video APP.

Tu rol:
- Responde SIEMPRE en espanol, con tono profesional, cercano y resolutivo.
- Se claro y breve; usa listas cortas cuando ayuden.
- Ayuda a la persona a entender que servicio o producto se ajusta a su necesidad y a dar el siguiente paso.
- Cuando haya interes real, invita a cotizar o a contactar por WhatsApp (+57 314 637 5605) o correo (proyectos@creativostecnologicosit.com), o a usar el formulario de contacto.
- No inventes precios ni plazos exactos; ofrece rangos generales y sugiere agendar una conversacion para una propuesta a la medida.
- Si preguntan algo fuera del alcance de la empresa, reorienta con amabilidad.
- Usa **negritas** para destacar y guiones para listas.`;

// ---------------------------------------------------------------------
//  Prompt de la seccion NOTICIAS (usa busqueda web, responde JSON)
// ---------------------------------------------------------------------
const NEWS_SYS = `Eres el editor de tendencias e innovacion de IT CREATIVOS TECNOLOGICOS, una empresa de base tecnologica e innovacion. Entregas 5 tarjetas con desarrollos, noticias, articulos o informes RECIENTES y reales relevantes para sus sectores: tecnologia, software a la medida, IoT, inteligencia artificial, energia solar, ciudades inteligentes, agroindustria, educacion, medio ambiente y transformacion digital.

COMO TRABAJAS:
- Usa la herramienta de busqueda web para encontrar informacion actual y verificable, preferiblemente de las ultimas semanas. Haz varias busquedas si hace falta.
- Basa cada tarjeta en un resultado real de la busqueda. NO inventes hechos, cifras, fechas, fuentes ni URLs. Si no encuentras un dato, omite ese campo.

FORMATO DE SALIDA:
- Responde UNICAMENTE con un arreglo JSON valido, sin texto adicional, sin markdown ni bloques de codigo.
- Exactamente 5 objetos con esta forma: {"etiqueta":"...","titulo":"...","resumen":"...","fuente":"...","url":"...","fecha":"..."}.
- etiqueta: 1-2 palabras de categoria (IA, IoT, Energia, Ciudades, Agro, Software, Datos, Salud, Educacion, Ambiente).
- titulo: maximo 12 palabras, claro y en espanol.
- resumen: 1 o 2 frases (maximo 45 palabras) en espanol, fiel a la fuente.
- fuente: nombre del medio o sitio (ej: Reuters, MIT Technology Review).
- url: enlace real (https://...) tomado de los resultados de busqueda.
- fecha: fecha de publicacion en formato corto (ej: 12 jun 2026) si la conoces.
- Varia los sectores entre las 5 tarjetas y enfoca el resumen en por que la tendencia importa para organizaciones y territorios.`;

// Límite anti-abuso: al ser un endpoint público, evita que alguien dispare costos.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 solicitudes por minuto por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.' },
});

const MAX_MENSAJES = 20;
const MAX_CHARS_MSJ = 4000;

// POST /api/assistant
//   body chat:     { messages: [{role, content}, ...] }
//   body noticias: { messages: [...], mode: 'news' }
// Responde { content: [...] }  (misma forma que la API de Anthropic, que el front ya lee).
router.post(
  '/',
  chatLimiter,
  asyncHandler(async (req, res) => {
    const { messages, mode } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new AppError(400, 'Falta el historial de la conversación');
    }

    // Sanea y valida cada turno.
    const limpios = [];
    for (const m of messages.slice(-MAX_MENSAJES)) {
      if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue;
      const content = typeof m.content === 'string' ? m.content.trim() : '';
      if (!content) continue;
      limpios.push({ role: m.role, content: content.slice(0, MAX_CHARS_MSJ) });
    }
    while (limpios.length && limpios[0].role !== 'user') limpios.shift();
    if (!limpios.length) throw new AppError(400, 'No hay un mensaje válido del usuario');

    const esNoticias = mode === 'news';
    const params = {
      model: MODEL,
      max_tokens: esNoticias ? 2000 : 1024,
      system: esNoticias ? NEWS_SYS : CHAT_SYS,
      messages: limpios,
    };
    // El modo noticias necesita búsqueda web para traer información reciente y real.
    if (esNoticias) {
      params.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
    }

    let respuesta;
    try {
      respuesta = await anthropic.messages.create(params);
    } catch (err) {
      console.error('Error al llamar a la API de Anthropic:', err.status || '', err.message);
      throw new AppError(502, 'El asistente no está disponible en este momento. Intenta más tarde.');
    }

    // Forma compatible con el frontend (lee data.content) y también con otros clientes (reply).
    const texto = (respuesta.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    res.json({ content: respuesta.content, reply: texto });
  })
);

module.exports = router;
