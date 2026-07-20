// =====================================================================
//  Envío de correos (notificaciones del portal BOIT)
//  Usa Resend si hay RESEND_API_KEY; si no, solo registra en consola
//  para no romper el flujo del pedido. El correo NUNCA bloquea la venta.
// =====================================================================

// Correo interno que recibe los pedidos (superadmin / líder).
// Ajústalo en Render con la variable NOTIFY_EMAIL si cambia.
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || 'creativostecnologicosit@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'BOIT <onboarding@resend.dev>';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

async function enviarCorreo({ para, asunto, html }) {
  const destinos = Array.isArray(para) ? para : [para];
  if (!RESEND_API_KEY) {
    console.log('[correo:simulado]', asunto, '->', destinos.join(', '));
    return { simulado: true };
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_EMAIL, to: destinos, subject: asunto, html }),
    });
    if (!res.ok) {
      const detalle = await res.text();
      console.error('[correo:error]', res.status, detalle.slice(0, 300));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error('[correo:excepcion]', err.message);
    return { ok: false };
  }
}

// ---------------------------------------------------------------------
//  Plantilla base con la identidad BOIT
// ---------------------------------------------------------------------
function plantilla(titulo, cuerpo, cta) {
  return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#f3f2ef;font-family:Segoe UI,Arial,sans-serif;color:#242530">
  <div style="max-width:600px;margin:0 auto;padding:24px">
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
    .map(
      ([k, v]) =>
        `<tr><td style="padding:7px 0;color:#6d6e78;width:38%">${k}</td><td style="padding:7px 0;font-weight:600">${v}</td></tr>`
    )
    .join('')}</table>`;
}

// ---------------------------------------------------------------------
//  1. Pedido nuevo -> avisa al superadmin y al líder
// ---------------------------------------------------------------------
async function avisarPedidoNuevo(pedido, items, correosInternos = []) {
  const lista = items
    .map((i) => `<li>${i.cantidad} × ${i.nombre_servicio} — USD ${i.precio_unit_usd}</li>`)
    .join('');
  const cuerpo =
    filas([
      ['Folio', pedido.folio],
      ['Cliente', pedido.nombre],
      ['Entidad', pedido.entidad],
      ['Correo', pedido.correo],
      ['Teléfono', pedido.telefono],
      ['Total', `USD ${pedido.total_usd}`],
    ]) +
    `<h3 style="font-size:14px;margin:20px 0 8px">Servicios solicitados</h3>
     <ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.7">${lista}</ul>` +
    (pedido.descripcion
      ? `<h3 style="font-size:14px;margin:20px 0 8px">Descripción</h3>
         <p style="font-size:14px;line-height:1.6;margin:0">${pedido.descripcion}</p>`
      : '');

  const destinos = [NOTIFY_EMAIL, ...correosInternos].filter(Boolean);
  return enviarCorreo({
    para: [...new Set(destinos)],
    asunto: `Nuevo pedido ${pedido.folio} — ${pedido.nombre}`,
    html: plantilla('Nuevo pedido recibido', cuerpo, {
      url: (process.env.PORTAL_URL || 'https://www.creativostecnologicosit.com/tablero/') + '#pedidos',
      texto: 'Ver y asignar el pedido',
    }),
  });
}

// ---------------------------------------------------------------------
//  2. Confirmación al cliente
// ---------------------------------------------------------------------
async function confirmarAlCliente(pedido) {
  const cuerpo =
    `<p style="font-size:14px;line-height:1.6;margin:0 0 16px">Estimado(a) ${pedido.nombre}, hemos recibido su solicitud.
     Nuestro equipo la revisará y le enviaremos la cotización formal.</p>` +
    filas([
      ['Folio', pedido.folio],
      ['Total estimado', `USD ${pedido.total_usd}`],
      ['Estado', 'Recibido'],
    ]);
  return enviarCorreo({
    para: pedido.correo,
    asunto: `Recibimos su solicitud ${pedido.folio} — Creativos Tecnológicos IT`,
    html: plantilla('Su solicitud fue recibida', cuerpo),
  });
}

// ---------------------------------------------------------------------
//  3. Entregable listo -> enlace de descarga (se activa al pagar)
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
    html: plantilla(
      pagado ? 'Sus documentos están listos' : 'Su pedido está listo',
      cuerpo,
      { url: urlPago, texto: pagado ? 'Descargar documentos' : 'Pagar y descargar' }
    ),
  });
}

module.exports = {
  NOTIFY_EMAIL,
  enviarCorreo,
  plantilla,
  avisarPedidoNuevo,
  confirmarAlCliente,
  avisarEntregableListo,
};
