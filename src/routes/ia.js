const express = require('express');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');
const { logAudit } = require('../audit');
const { avisarEntregableListo } = require('../mailer');
const { AppError, asyncHandler, authenticate } = require('../middleware');

const router = express.Router();
const anthropic = new Anthropic();

const MODEL = 'claude-opus-4-8';
const ADMINES = ['super_admin', 'lider'];
const INTERNOS = ['super_admin', 'lider', 'gestor', 'investigador'];

// Columnas para el documento generado (se crean solas la primera vez).
let colsListas = false;
async function asegurarColumnas() {
  if (colsListas) return;
  await db.query('ALTER TABLE entregable ADD COLUMN IF NOT EXISTS contenido text');
  await db.query('ALTER TABLE entregable ADD COLUMN IF NOT EXISTS estado_ia text');
  await db.query('ALTER TABLE entregable ADD COLUMN IF NOT EXISTS actividad_id uuid REFERENCES actividad(id) ON DELETE SET NULL');
  // El documento de IA no nace con URL (se calcula tras el INSERT). Permitir nulo.
  await db.query('ALTER TABLE entregable ALTER COLUMN url DROP NOT NULL').catch(function () {});
  colsListas = true;
}

const OUTLINES = {
  negocio: ['Resumen ejecutivo','Descripción del negocio','Propuesta de valor','Segmento de clientes',
    'Análisis del mercado y competencia','Modelo de ingresos y estructura de costos','Operación y recursos clave',
    'Plan de implementación','Proyección financiera a 3 años','Riesgos y mitigación','Conclusiones'],
  mercado: ['Resumen ejecutivo','Objetivos del estudio','Metodología','Tamaño y segmentación del mercado',
    'Análisis de la demanda','Análisis de la oferta y competencia','Precios y canales','Tendencias',
    'Conclusiones y recomendaciones'],
  riesgo: ['Resumen ejecutivo','Alcance y contexto','Metodología de análisis','Identificación de riesgos',
    'Valoración (probabilidad × impacto)','Matriz de riesgos','Plan de tratamiento y controles',
    'Indicadores de seguimiento','Conclusiones'],
  investigacion: ['Resumen','Planteamiento del problema','Justificación','Objetivos (general y específicos)',
    'Marco teórico y estado del arte','Metodología','Cronograma','Presupuesto',
    'Resultados esperados e indicadores','Referencias'],
  emprendimiento: ['Resumen ejecutivo','La idea y propuesta de valor','Validación','Mercado objetivo',
    'Modelo de negocio','Plan de mercadeo','Plan operativo','Proyección financiera','Plan de lanzamiento','Riesgos'],
  social: ['Resumen','Diagnóstico y línea base','Justificación y pertinencia','Objetivos','Marco lógico',
    'Beneficiarios','Actividades y cronograma','Presupuesto','Indicadores de impacto','Sostenibilidad'],
  ambiental: ['Resumen','Diagnóstico ambiental','Marco normativo','Objetivos','Identificación de impactos',
    'Plan de manejo ambiental','Cronograma','Presupuesto','Indicadores','Conclusiones'],
  hidrico: ['Resumen','Contexto y caracterización del recurso hídrico','Diagnóstico','Objetivos',
    'Alternativas de intervención','Análisis técnico','Plan de acción','Cronograma','Presupuesto','Indicadores'],
  cultural: ['Resumen','Contexto cultural','Justificación y pertinencia','Objetivos','Descripción de la propuesta',
    'Plan de circulación y actividades','Cronograma','Presupuesto','Indicadores','Sostenibilidad'],
  contable: ['Resumen','Objeto y alcance','Estructura de costos','Estados e informes financieros','Análisis',
    'Notas explicativas','Recomendaciones'],
  juridico: ['Resumen','Antecedentes y contexto','Marco normativo aplicable','Análisis jurídico',
    'Conceptos y conclusiones','Recomendaciones','Anexos sugeridos'],
};
const OUTLINE_DEFAULT = ['Resumen ejecutivo','Contexto y objetivos','Desarrollo','Recomendaciones','Conclusiones'];

const SYSTEM = `Eres un consultor senior de Creativos Tecnológicos IT — Back Office Inteligente (BOIT).
Redactas documentos profesionales, completos y bien estructurados en español de Colombia, listos para
entregar a clientes (entidades públicas, privadas, ONG, academia).

Reglas:
- Escribe en Markdown: usa # para el título, ## para secciones, ### para subsecciones, listas con - y **negritas**.
- Sé riguroso, claro y práctico. Desarrolla cada sección con profundidad real, no con frases genéricas.
- NO inventes datos falsos (cifras, fuentes, fechas, nombres). Cuando falte un dato específico del cliente,
  usa un marcador entre corchetes como [POR DEFINIR: presupuesto estimado] para que el consultor lo complete.
- Adapta el contenido al sector y al requerimiento del cliente.
- No incluyas comentarios sobre ti mismo ni sobre que eres una IA. Entrega solo el documento.`;

async function generarDocumento(entregableId, datos) {
  const { nombreServicio, categoria, cliente, entidad, requerimiento, especificaciones, instrucciones } = datos;
  const secciones = OUTLINES[categoria] || OUTLINE_DEFAULT;
  const userPrompt =
`Elabora un documento profesional del tipo: **${nombreServicio}**.

Cliente: ${cliente}${entidad ? ` (${entidad})` : ''}.

Requerimiento del cliente:
${requerimiento || '(No se especificó requerimiento detallado; redacta un documento base de alta calidad para este tipo de servicio, con marcadores [POR DEFINIR] donde falte información.)'}
${especificaciones ? `\nEspecificaciones adicionales:\n${especificaciones}` : ''}
${instrucciones ? `\nInstrucciones del consultor:\n${instrucciones}` : ''}

Estructura el documento con al menos estas secciones (ajústalas si el caso lo amerita):
${secciones.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Empieza directamente con el título en formato # y desarrolla todo el contenido.`;

  try {
    const resp = await anthropic.messages.create({
      model: MODEL, max_tokens: 8000, system: SYSTEM,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const texto = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texto) throw new Error('Respuesta vacía del modelo');
    await db.query(
      "UPDATE entregable SET contenido = $1, estado_ia = 'listo', nombre = replace(nombre, ' (generando…)', '') WHERE id = $2",
      [texto, entregableId]);
  } catch (err) {
    console.error('Generación IA:', err.status || '', err.message);
    await db.query("UPDATE entregable SET estado_ia = 'error' WHERE id = $1", [entregableId]);
  }
}

const genLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 12,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiadas generaciones seguidas. Espere unos minutos.' },
});

// =====================================================================
//  POST /api/pedidos/:pedidoId/generar-ia  (admin / responsable)
//  body: { item_id?, instrucciones? }
//  Requiere que el pedido ya esté asignado (tenga proyecto + actividades).
// =====================================================================
router.post(
  '/pedidos/:pedidoId/generar-ia',
  authenticate,
  genLimiter,
  asyncHandler(async (req, res) => {
    await asegurarColumnas();
    if (!INTERNOS.includes(req.user.rol_global)) throw new AppError(403, 'Sin permisos');

    const { rows: ped } = await db.query(
      'SELECT * FROM pedido WHERE id = $1 AND eliminado_en IS NULL', [req.params.pedidoId]);
    const pedido = ped[0];
    if (!pedido) throw new AppError(404, 'Pedido no encontrado');
    const esAdmin = ADMINES.includes(req.user.rol_global);
    if (!esAdmin && pedido.asignado_a !== req.user.id && pedido.apoyo_id !== req.user.id) {
      throw new AppError(403, 'Este pedido no está asignado a usted');
    }
    if (!pedido.proyecto_id) {
      throw new AppError(400, 'Primero asigne el pedido a un gestor: eso crea el proyecto y las actividades. Luego genere el documento y quedará en su actividad.');
    }

    const { rows: items } = await db.query(
      `SELECT pi.*, s.categoria FROM pedido_item pi
       LEFT JOIN servicio s ON s.id = pi.servicio_id WHERE pi.pedido_id = $1`, [pedido.id]);
    if (!items.length) throw new AppError(400, 'El pedido no tiene servicios');
    const item = req.body.item_id ? items.find((i) => i.id === req.body.item_id) : items[0];
    if (!item) throw new AppError(400, 'Servicio no encontrado en el pedido');

    // Actividad correspondiente a ese servicio dentro del proyecto
    const { rows: acts } = await db.query(
      `SELECT id FROM actividad
       WHERE proyecto_id = $1 AND eliminado_en IS NULL
         AND (producto = $2 OR titulo LIKE '%' || $2)
       ORDER BY creado_en LIMIT 1`, [pedido.proyecto_id, item.nombre_servicio]);
    const actividadId = acts[0] ? acts[0].id : null;

    const { rows } = await db.query(
      `INSERT INTO entregable (pedido_id, actividad_id, nombre, descripcion, tipo, producido_por, subido_por, estado_ia)
       VALUES ($1,$2,$3,$4,'documento','agente_virtual',$5,'generando') RETURNING *`,
      [pedido.id, actividadId, `${item.nombre_servicio} — Documento (IA) (generando…)`,
       'Documento generado por el agente virtual, pendiente de revisión y aprobación.', req.user.id]);
    const entregable = rows[0];

    const API_URL = process.env.API_URL || 'https://tablero-control-api.onrender.com';
    await db.query('UPDATE entregable SET url = $1 WHERE id = $2',
      [`${API_URL}/api/entregables/${entregable.id}/documento?t=${entregable.token_descarga}`, entregable.id]);

    // La actividad pasa a "en_progreso" mientras el agente trabaja
    if (actividadId) {
      await db.query("UPDATE actividad SET estado = 'en_progreso' WHERE id = $1 AND estado = 'sin_iniciar'", [actividadId]);
    }
    await logAudit({ usuarioId: req.user.id, entidad: 'entregable', entidadId: entregable.id,
                     accion: 'generar_ia', detalle: { servicio: item.nombre_servicio, actividad: actividadId } });

    generarDocumento(entregable.id, {
      nombreServicio: item.nombre_servicio, categoria: item.categoria,
      cliente: pedido.nombre, entidad: pedido.entidad, requerimiento: pedido.descripcion,
      especificaciones: item.especificaciones, instrucciones: (req.body.instrucciones || '').slice(0, 3000),
    });

    res.status(202).json({ id: entregable.id, actividad_id: actividadId, estado_ia: 'generando' });
  })
);

// =====================================================================
//  GET /api/actividades/:id/documento-ia  (interno)
//  Documento generado ligado a una actividad (para revisar/aprobar).
// =====================================================================
router.get(
  '/actividades/:id/documento-ia',
  authenticate,
  asyncHandler(async (req, res) => {
    await asegurarColumnas();
    if (!INTERNOS.includes(req.user.rol_global)) throw new AppError(403, 'Sin permisos');
    const { rows } = await db.query(
      `SELECT e.id, e.nombre, e.estado_ia, e.contenido, e.producido_por,
              e.validado_en, u.nombre AS validado_por_nombre, e.creado_en
       FROM entregable e LEFT JOIN usuario u ON u.id = e.validado_por
       WHERE e.actividad_id = $1 AND e.producido_por = 'agente_virtual'
       ORDER BY e.creado_en DESC LIMIT 1`, [req.params.id]);
    res.json(rows[0] || null);
  })
);

// GET /api/entregables/:id  (interno) — traer contenido para editar
router.get(
  '/entregables/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    await asegurarColumnas();
    if (!INTERNOS.includes(req.user.rol_global)) throw new AppError(403, 'Sin permisos');
    const { rows } = await db.query(
      'SELECT id, pedido_id, actividad_id, nombre, contenido, estado_ia, validado_en FROM entregable WHERE id = $1',
      [req.params.id]);
    if (!rows[0]) throw new AppError(404, 'Entregable no encontrado');
    res.json(rows[0]);
  })
);

// PATCH /api/entregables/:id/contenido  (interno) — guardar edición del líder
router.patch(
  '/entregables/:id/contenido',
  authenticate,
  asyncHandler(async (req, res) => {
    await asegurarColumnas();
    if (!INTERNOS.includes(req.user.rol_global)) throw new AppError(403, 'Sin permisos');
    if (typeof req.body.contenido !== 'string') throw new AppError(400, 'Contenido inválido');
    const { rows } = await db.query(
      "UPDATE entregable SET contenido = $1, estado_ia = 'listo' WHERE id = $2 RETURNING id",
      [req.body.contenido.slice(0, 200000), req.params.id]);
    if (!rows[0]) throw new AppError(404, 'Entregable no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'entregable', entidadId: req.params.id, accion: 'editar' });
    res.json({ ok: true });
  })
);

// POST /api/entregables/:id/aprobar  (solo líder/admin)
//  Aprueba el documento: valida, completa la actividad y notifica al cliente.
router.post(
  '/entregables/:id/aprobar',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!ADMINES.includes(req.user.rol_global)) {
      throw new AppError(403, 'Solo el líder o el super admin pueden aprobar');
    }
    const { rows } = await db.query(
      `UPDATE entregable SET validado_por = $1, validado_en = now() WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]);
    const ent = rows[0];
    if (!ent) throw new AppError(404, 'Entregable no encontrado');

    if (ent.actividad_id) {
      await db.query("UPDATE actividad SET estado = 'completo', avance = 100 WHERE id = $1", [ent.actividad_id]);
    }
    const { rows: ped } = await db.query('SELECT * FROM pedido WHERE id = $1', [ent.pedido_id]);
    const pedido = ped[0];
    if (pedido) {
      await db.query(
        "UPDATE pedido SET estado = 'entregado', entregado_en = now() WHERE id = $1 AND estado NOT IN ('pagado','cerrado')",
        [pedido.id]);
      const pagado = ['pagado', 'cerrado'].includes(pedido.estado);
      const PORTAL = process.env.PORTAL_URL || 'https://www.creativostecnologicosit.com';
      const urlPago = `${PORTAL}/pago.html?pedido=${pedido.id}&correo=${encodeURIComponent(pedido.correo)}`;
      avisarEntregableListo(pedido, urlPago, pagado).catch((e) => console.error('Aviso:', e.message));
    }
    await logAudit({ usuarioId: req.user.id, entidad: 'entregable', entidadId: ent.id, accion: 'aprobar' });
    res.json({ ok: true });
  })
);

// GET /api/entregables/:id/documento?t=TOKEN — documento con marca BOIT (cliente pagado)
router.get(
  '/entregables/:id/documento',
  asyncHandler(async (req, res) => {
    await asegurarColumnas();
    const { rows } = await db.query(
      `SELECT e.contenido, e.token_descarga, p.estado AS estado_pedido, p.folio, p.nombre AS cliente
       FROM entregable e JOIN pedido p ON p.id = e.pedido_id WHERE e.id = $1`, [req.params.id]);
    const e = rows[0];
    if (!e || !e.contenido) throw new AppError(404, 'Documento no disponible');
    if (!req.query.t || req.query.t !== e.token_descarga) throw new AppError(403, 'Enlace no válido');
    if (!['pagado', 'cerrado'].includes(e.estado_pedido)) {
      throw new AppError(402, 'El documento se habilita una vez confirmado el pago.');
    }
    await db.query('UPDATE entregable SET descargas = descargas + 1, ultima_descarga = now() WHERE id = $1', [req.params.id]);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(paginaDocumento(e.contenido, e.folio, e.cliente));
  })
);

function paginaDocumento(markdown, folio, cliente) {
  const mdJson = JSON.stringify(markdown).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${folio} — Creativos Tecnológicos IT</title>
<style>:root{--red:#BB1111;--ink:#242530;--mut:#6d6e78;--line:#dcdad4}*{box-sizing:border-box}
body{margin:0;background:#f3f2ef;color:var(--ink);font-family:Georgia,serif;line-height:1.6}
.hoja{max-width:820px;margin:24px auto;background:#fff;padding:56px 64px;box-shadow:0 6px 24px rgba(0,0,0,.08)}
.cab{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid var(--red);padding-bottom:14px;margin-bottom:32px;font-family:Arial,sans-serif}
.cab b{font-size:20px;letter-spacing:1px}.cab small{color:var(--mut);display:block;font-size:10px;letter-spacing:2px}.cab .f{color:var(--mut);font-size:13px;text-align:right}
h1{font-size:26px;margin:0 0 18px}h2{font-size:19px;margin:28px 0 10px;color:var(--red);font-family:Arial,sans-serif}h3{font-size:16px;margin:20px 0 8px;font-family:Arial,sans-serif}
p,li{font-size:15px}table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}th,td{border:1px solid var(--line);padding:7px 10px;text-align:left}th{background:#f3f2ef}
.pie{margin-top:40px;border-top:1px solid var(--line);padding-top:12px;color:var(--mut);font-size:11px;font-family:Arial,sans-serif}
@media print{body{background:#fff}.hoja{box-shadow:none;margin:0;padding:0 20px}}</style></head><body>
<div class="hoja"><div class="cab"><div><b>BOIT</b><small>BACK OFFICE INTELIGENTE</small></div><div class="f">${folio}<br>${cliente || ''}</div></div>
<div id="doc"></div><div class="pie">Creativos Tecnológicos IT SAS · NIT 901.626.560 · Sincelejo, Sucre · +57 314 637 5605<br>Documento producido por el Back Office Inteligente y validado por el equipo consultor.</div></div>
<script>var MD=${mdJson};${MD_RENDER}document.getElementById('doc').innerHTML=mdToHtml(MD);</script></body></html>`;
}

module.exports = router;

// Renderizador Markdown compacto, inyectado como texto en la página del documento.
function _mdRender() {
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function inline(s){return esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>').replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');}
  function mdToHtml(md){
    var lines=String(md||'').replace(/\r/g,'').split('\n'),html='',i=0;
    while(i<lines.length){var l=lines[i];
      if(/^\s*###\s+/.test(l)){html+='<h3>'+inline(l.replace(/^\s*###\s+/,''))+'</h3>';i++;continue;}
      if(/^\s*##\s+/.test(l)){html+='<h2>'+inline(l.replace(/^\s*##\s+/,''))+'</h2>';i++;continue;}
      if(/^\s*#\s+/.test(l)){html+='<h1>'+inline(l.replace(/^\s*#\s+/,''))+'</h1>';i++;continue;}
      if(/^\s*\|(.+)\|\s*$/.test(l)&&i+1<lines.length&&/^\s*\|[\s:|-]+\|\s*$/.test(lines[i+1])){
        var rows=[];while(i<lines.length&&/^\s*\|(.+)\|\s*$/.test(lines[i])){rows.push(lines[i]);i++;}
        html+='<table>';rows.forEach(function(r,ri){if(ri===1)return;var cells=r.replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|');
        html+='<tr>'+cells.map(function(c){var t=ri===0?'th':'td';return '<'+t+'>'+inline(c.trim())+'</'+t+'>';}).join('')+'</tr>';});html+='</table>';continue;}
      if(/^\s*[-*]\s+/.test(l)){html+='<ul>';while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){html+='<li>'+inline(lines[i].replace(/^\s*[-*]\s+/,''))+'</li>';i++;}html+='</ul>';continue;}
      if(/^\s*\d+\.\s+/.test(l)){html+='<ol>';while(i<lines.length&&/^\s*\d+\.\s+/.test(lines[i])){html+='<li>'+inline(lines[i].replace(/^\s*\d+\.\s+/,''))+'</li>';i++;}html+='</ol>';continue;}
      if(/^\s*$/.test(l)){i++;continue;}
      var para=l;while(i+1<lines.length&&!/^\s*$/.test(lines[i+1])&&!/^\s*(#|[-*]|\d+\.|\|)/.test(lines[i+1])){i++;para+=' '+lines[i];}
      html+='<p>'+inline(para)+'</p>';i++;}
    return html;}
  return mdToHtml;
}
var MD_RENDER = 'var mdToHtml=(' + _mdRender.toString() + ')();';
