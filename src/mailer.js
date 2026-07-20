// =====================================================================
//  Envío de correos (notificaciones del portal BOIT)
//  Usa Resend si hay RESEND_API_KEY; si no, solo registra en consola
//  para no romper el flujo. El correo NUNCA bloquea la operación.
// =====================================================================

const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'creativostecnologicosit@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'BOIT <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const TABLERO_URL = process.env.TABLERO_URL || 'https://www.creativostecnologicosit.com/tablero/';

async function enviarCorreo({ para, asunto, html }) {
  const destinos = (Array.isArray(para) ? para : [para]).filter(Boolean);
  if (!destinos.length) return { ok: false };
  if (!RESEND_API_KEY) {
    console.log('[correo:simulado]', asunto, '->', destinos.join(', '));
    return { simulado: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: destinos, subject: asunto, html }),
    });
    if (!res.ok) {
      console.error('[correo:error]', res.status, (await res.text()).slice(0, 300));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('[correo:excepcion]', err.message);
    return { ok: false };
  }
}

function plantilla(titulo, cuerpo, cta) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#f3f2ef;font-family:Segoe UI,Arial,sans-serif;color:#242530">
  <div style="max-width:620px;margin:0 auto;padding:24px">
    <div style="background:#242530;border-radius:14px 14px 0 0;padding:18px 24px">
      <span style="color:#fff;font-size:19px;font-weight:700;letter-spacing:.5px">BOIT</span>
      <span style="color:#9a9bab;font-size:10px;letter-spacing:2px;display:block;margin-top:3px">BACK OFFICE INTELIGENTE</span>
    </div>
    <div style="background:#fff;border:1px solid #dcdad4;border-top:none;border-radius:0 0 14px 14px;padding:26px 24px">
      <h1 style="font-size:18px;margin:0 0 14px">${titulo}</h1>
      ${cuerpo}
      ${cta ? `<div style="margin-top:24px"><a href="${cta.url}" style="background:#BB1111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">${cta.texto}</a></div>` : ''}
    </div>
    <p style="color:#6d6e78;font-size:11px;text-align:center;margin:18px 0 0">
      Creativos Tecnológicos IT · Sincelejo, Sucre · +57 314 637 5605
    </p>
  </div></body></html>`;
}

function filas(pares) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${pares
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) =>
      `<tr><td style="padding:7px 0;color:#6d6e78;width:38%">${k}</td><td style="padding:7px 0;font-weight:600">${v}</td></tr>`)
    .join('')}</table>`;
}

function cop(n) {
  const v = Number(n || 0);
  if (!v) return 'Por cotizar';
  return '$ ' + v.toLocaleString('es-CO', { maximumFractionDigits: 0 }) + ' COP';
}

function fechaCorta(d) {
  if (!d) return null;
  const f = new Date(d);
  if (isNaN(f)) return String(d);
  return f.toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------------
//  1. Pedido nuevo -> superadmin y líder
// ---------------------------------------------------------------------
async function avisarPedidoNuevo(pedido, items, correosInternos = []) {
  const lista = items
    .map((i) => `<li>${i.cantidad} × ${i.nombre_servicio}</li>`).join('');
  const cuerpo =
    filas([
      ['Folio', pedido.folio], ['Cliente', pedido.nombre], ['Entidad', pedido.entidad],
      ['Correo', pedido.correo], ['Teléfono', pedido.telefono],
      ['Fecha límite', fechaCorta(pedido.fecha_limite)], ['Valor', cop(pedido.total_usd)],
    ]) +
    `<h3 style="font-size:14px;margin:20px 0 8px">Servicios solicitados</h3>
     <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${lista}</ul>` +
    (pedido.descripcion
      ? `<h3 style="font-size:14px;margin:20px 0 8px">Descripción</h3>
         <p style="font-size:14px;line-height:1.6;margin:0">${pedido.descripcion}</p>` : '');

  return enviarCorreo({
    para: [...new Set([NOTIFY_EMAIL, ...correosInternos])],
    asunto: `Nuevo pedido ${pedido.folio} — ${pedido.nombre}`,
    html: plantilla('Nuevo pedido recibido', cuerpo, {
      url: TABLERO_URL, texto: 'Ver y asignar el pedido',
    }),
  });
}

// ---------------------------------------------------------------------
//  2. Confirmación al cliente
// ---------------------------------------------------------------------
async function confirmarAlCliente(pedido) {
  const cuerpo =
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Estimado(a) ${pedido.nombre}, hemos recibido su solicitud.
     Nuestro equipo revisará el alcance y le enviará la cotización formal en pesos colombianos.</p>` +
    filas([['Folio', pedido.folio], ['Valor', cop(pedido.total_usd)],
           ['Entrega estimada', fechaCorta(pedido.fecha_limite)], ['Estado', 'Recibido']]);
  return enviarCorreo({
    para: pedido.correo,
    asunto: `Recibimos su solicitud ${pedido.folio} — Creativos Tecnológicos IT`,
    html: plantilla('Su solicitud fue recibida', cuerpo),
  });
}

// ---------------------------------------------------------------------
//  3. ASIGNACIÓN -> al responsable (gestor y/o joven investigador)
//     Lleva TODA la información para que pueda entrar y trabajar.
// ---------------------------------------------------------------------
async function avisarAsignacion({ pedido, proyecto, actividades, responsable, rol, quienAsigna }) {
  if (!responsable || !responsable.email) return { ok: false };

  const tareas = (actividades || [])
    .map((a) => `<li><b>${a.titulo}</b>${a.producto ? ` — entregable: ${a.producto}` : ''}</li>`).join('');

  const cuerpo =
    `<p style="font-size:14px;line-height:1.6;margin:0 0 18px">
      ${responsable.nombre}, se le asignó un nuevo trabajo como <b>${rol}</b>.
      A continuación encontrará toda la información para ejecutarlo.</p>` +

    `<h3 style="font-size:14px;margin:0 0 8px;color:#BB1111">Pedido</h3>` +
    filas([
      ['Folio', pedido.folio],
      ['Cliente', pedido.nombre + (pedido.entidad ? ` · ${pedido.entidad}` : '')],
      ['Contacto', pedido.correo],
      ['Valor', cop(pedido.total_usd)],
    ]) +

    `<h3 style="font-size:14px;margin:22px 0 8px;color:#BB1111">Tiempos</h3>` +
    filas([
      ['Fecha de inicio', fechaCorta(proyecto && proyecto.fecha_inicio) || 'hoy'],
      ['Fecha de entrega', fechaCorta(pedido.fecha_limite)],
      ['Asignado por', quienAsigna || 'Coordinación'],
      ['Agente virtual', pedido.agente_virtual],
    ]) +

    (tareas
      ? `<h3 style="font-size:14px;margin:22px 0 8px;color:#BB1111">Actividades a su cargo</h3>
         <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.8">${tareas}</ul>` : '') +

    (pedido.descripcion
      ? `<h3 style="font-size:14px;margin:22px 0 8px;color:#BB1111">Requerimiento del cliente</h3>
         <p style="font-size:14px;line-height:1.6;margin:0">${pedido.descripcion}</p>` : '') +

    (pedido.notas_internas
      ? `<h3 style="font-size:14px;margin:22px 0 8px;color:#BB1111">Notas internas</h3>
         <p style="font-size:14px;line-height:1.6;margin:0">${pedido.notas_internas}</p>` : '') +

    `<p style="font-size:13px;line-height:1.6;margin:22px 0 0;color:#6d6e78">
      Ingrese al tablero con su usuario para ver el detalle, registrar avance y
      <b>subir el documento final</b> cuando esté listo.</p>`;

  return enviarCorreo({
    para: responsable.email,
    asunto: `Nueva asignación ${pedido.folio} — entrega ${fechaCorta(pedido.fecha_limite) || 'por definir'}`,
    html: plantilla('Se le asignó un nuevo trabajo', cuerpo, {
      url: TABLERO_URL, texto: 'Entrar al tablero',
    }),
  });
}

// ---------------------------------------------------------------------
//  4. Entregable listo -> cliente
// ---------------------------------------------------------------------
async function avisarEntregableListo(pedido, urlPago, pagado) {
  const cuerpo = pagado
    ? `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Su pedido <b>${pedido.folio}</b> está listo.
       Ya puede descargar sus documentos.</p>`
    : `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Su pedido <b>${pedido.folio}</b> está listo.
       Para habilitar la descarga, por favor complete el pago. El enlace se activa automáticamente
       apenas se confirme la transacción.</p>`;
  return enviarCorreo({
    para: pedido.correo,
    asunto: pagado
      ? `Su pedido ${pedido.folio} está listo para descargar`
      : `Su pedido ${pedido.folio} está listo — complete el pago para descargar`,
    html: plantilla(pagado ? 'Sus documentos están listos' : 'Su pedido está listo', cuerpo,
      { url: urlPago, texto: pagado ? 'Descargar documentos' : 'Pagar y descargar' }),
  });
}

module.exports = {
  NOTIFY_EMAIL,
  enviarCorreo,
  plantilla,
  avisarPedidoNuevo,
  confirmarAlCliente,
  avisarAsignacion,
  avisarEntregableListo,
};
