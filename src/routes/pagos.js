const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { logAudit } = require('../audit');
const { avisarEntregableListo } = require('../mailer');
const { AppError, asyncHandler, authenticate } = require('../middleware');

const router = express.Router();

// ---------------------------------------------------------------------
//  Configuración PayU (todo en variables de entorno, nunca en el código)
// ---------------------------------------------------------------------
const PAYU = {
  merchantId: process.env.PAYU_MERCHANT_ID || '',
  accountId: process.env.PAYU_ACCOUNT_ID || '',
  apiKey: process.env.PAYU_API_KEY || '',
  test: process.env.PAYU_TEST === 'true' ? '1' : '0',
  // Sandbox mientras PAYU_TEST=true; producción cuando esté en false.
  url:
    process.env.PAYU_TEST === 'true'
      ? 'https://sandbox.checkout.payulatam.com/ppp-web-gateway-payu/'
      : 'https://checkout.payulatam.com/ppp-web-gateway-payu/',
};
const PORTAL_URL = process.env.PORTAL_URL || 'https://www.creativostecnologicosit.com';
const API_URL = process.env.API_URL || 'https://tablero-control-api.onrender.com';
const MONEDA = process.env.PAYU_MONEDA || 'COP';

const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// =====================================================================
//  1. INICIAR PAGO — devuelve los datos del formulario de PayU
//     GET /api/pagos/checkout/:pedidoId   (cliente autenticado o por folio+correo)
// =====================================================================
router.get(
  '/pagos/checkout/:pedidoId',
  asyncHandler(async (req, res) => {
    if (!PAYU.merchantId || !PAYU.apiKey) {
      throw new AppError(503, 'La pasarela de pago aún no está configurada');
    }

    const { rows } = await db.query(
      'SELECT * FROM pedido WHERE id = $1 AND eliminado_en IS NULL',
      [req.params.pedidoId]
    );
    const pedido = rows[0];
    if (!pedido) throw new AppError(404, 'Pedido no encontrado');

    // Verificación simple de titularidad: el correo debe coincidir.
    const correo = (req.query.correo || '').toLowerCase();
    if (!correo || correo !== String(pedido.correo).toLowerCase()) {
      throw new AppError(403, 'Debe indicar el correo con el que realizó el pedido');
    }
    if (['pagado', 'cerrado'].includes(pedido.estado)) {
      return res.json({ yaPagado: true, mensaje: 'Este pedido ya fue pagado' });
    }

    // Referencia única por intento de pago.
    const referencia = `${pedido.folio}-${Date.now().toString(36).toUpperCase()}`;
    const monto = Number(pedido.total_usd).toFixed(2);

    await db.query(
      `INSERT INTO pago (pedido_id, referencia, monto, moneda, estado)
       VALUES ($1,$2,$3,$4,'pendiente')`,
      [pedido.id, referencia, monto, MONEDA]
    );

    // Firma PayU: MD5("ApiKey~merchantId~referenceCode~amount~currency")
    const firma = md5(`${PAYU.apiKey}~${PAYU.merchantId}~${referencia}~${monto}~${MONEDA}`);

    res.json({
      url: PAYU.url,
      campos: {
        merchantId: PAYU.merchantId,
        accountId: PAYU.accountId,
        description: `Pedido ${pedido.folio} — Creativos Tecnológicos IT`,
        referenceCode: referencia,
        amount: monto,
        tax: '0',
        taxReturnBase: '0',
        currency: MONEDA,
        signature: firma,
        test: PAYU.test,
        buyerEmail: pedido.correo,
        buyerFullName: pedido.nombre,
        responseUrl: `${PORTAL_URL}/pago-resultado.html`,
        confirmationUrl: `${API_URL}/api/pagos/confirmacion`,
      },
    });
  })
);

// =====================================================================
//  2. CONFIRMACIÓN (webhook de PayU) — aquí se aprueba el pago de verdad
//     POST /api/pagos/confirmacion
//     PayU envía application/x-www-form-urlencoded
// =====================================================================
router.post(
  '/pagos/confirmacion',
  express.urlencoded({ extended: false }),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const { merchant_id, reference_sale, value, currency, state_pol, sign, transaction_id } = b;

    // PayU exige responder 200 siempre; si algo falla, lo registramos.
    if (!reference_sale || !sign) {
      console.error('[payu] confirmación incompleta');
      return res.status(200).send('OK');
    }

    // Validación de firma: MD5("ApiKey~merchant_id~reference_sale~new_value~currency~state_pol")
    // PayU usa 1 decimal cuando el segundo decimal es cero.
    const v = parseFloat(value);
    const dos = v.toFixed(2);
    const uno = v.toFixed(1);
    const candidatas = [dos, uno].map((val) =>
      md5(`${PAYU.apiKey}~${merchant_id}~${reference_sale}~${val}~${currency}~${state_pol}`)
    );
    if (!candidatas.includes(String(sign).toLowerCase())) {
      console.error('[payu] firma inválida para', reference_sale);
      return res.status(200).send('OK');
    }

    // state_pol: 4 aprobado · 6 rechazado · 5 expirado · 7 pendiente
    const mapa = { '4': 'aprobado', '6': 'rechazado', '5': 'expirado', '7': 'pendiente' };
    const estadoPago = mapa[String(state_pol)] || 'pendiente';

    try {
      await db.tx(async (client) => {
        const { rows } = await client.query(
          `UPDATE pago SET estado = $1, transaccion_id = $2, estado_pasarela = $3,
                           respuesta = $4, pagado_en = CASE WHEN $1 = 'aprobado' THEN now() ELSE NULL END
           WHERE referencia = $5 RETURNING *`,
          [estadoPago, transaction_id || null, String(state_pol), JSON.stringify(b), reference_sale]
        );
        const pago = rows[0];
        if (!pago) {
          console.error('[payu] referencia desconocida', reference_sale);
          return;
        }
        if (estadoPago === 'aprobado') {
          // Solo aquí se habilita la descarga.
          await client.query(
            `UPDATE pedido SET estado = 'pagado' WHERE id = $1 AND estado <> 'cerrado'`,
            [pago.pedido_id]
          );
          await logAudit(
            { usuarioId: null, entidad: 'pago', entidadId: pago.id, accion: 'aprobar',
              detalle: { referencia: reference_sale } },
            client
          );
        }
      });
    } catch (e) {
      console.error('[payu] error al procesar confirmación:', e.message);
    }

    res.status(200).send('OK');
  })
);

// =====================================================================
//  3. DESCARGA CONTROLADA — solo si el pedido está pagado
//     GET /api/descargas/:token
// =====================================================================
router.get(
  '/descargas/:token',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT e.*, p.estado AS estado_pedido, p.folio
       FROM entregable e JOIN pedido p ON p.id = e.pedido_id
       WHERE e.token_descarga = $1`,
      [req.params.token]
    );
    const ent = rows[0];
    if (!ent) throw new AppError(404, 'Enlace de descarga no válido');

    if (!['pagado', 'cerrado'].includes(ent.estado_pedido)) {
      throw new AppError(402, 'El enlace se activa una vez confirmado el pago de su pedido');
    }
    if (!ent.validado_en) {
      throw new AppError(409, 'El documento aún está en validación');
    }

    await db.query(
      'UPDATE entregable SET descargas = descargas + 1, ultima_descarga = now() WHERE id = $1',
      [ent.id]
    );
    res.redirect(302, ent.url);
  })
);

// =====================================================================
//  4. ENTREGABLES (interno) — subir y validar
// =====================================================================
router.post(
  '/pedidos/:pedidoId/entregables',
  authenticate,
  asyncHandler(async (req, res) => {
    const rol = req.user.rol_global;
    if (!['super_admin', 'lider', 'gestor', 'investigador'].includes(rol)) {
      throw new AppError(403, 'No tiene permisos para subir entregables');
    }
    const { nombre, url, descripcion, tipo, producido_por } = req.body;
    if (!nombre || !url) throw new AppError(400, 'Faltan el nombre y la URL del entregable');

    const { rows } = await db.query(
      `INSERT INTO entregable (pedido_id, nombre, descripcion, url, tipo, producido_por, subido_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.pedidoId, nombre, descripcion || null, url,
       tipo || 'documento', producido_por || null, req.user.id]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'entregable', entidadId: rows[0].id, accion: 'crear' });
    res.status(201).json(rows[0]);
  })
);

// Validar y avisar al cliente (solo super admin y líder firman la calidad)
router.post(
  '/entregables/:id/validar',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!['super_admin', 'lider'].includes(req.user.rol_global)) {
      throw new AppError(403, 'Solo el super admin o el líder pueden validar entregables');
    }
    const { rows } = await db.query(
      `UPDATE entregable SET validado_por = $1, validado_en = now()
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    const ent = rows[0];
    if (!ent) throw new AppError(404, 'Entregable no encontrado');

    const { rows: ped } = await db.query('SELECT * FROM pedido WHERE id = $1', [ent.pedido_id]);
    const pedido = ped[0];
    if (pedido) {
      await db.query(
        `UPDATE pedido SET estado = 'entregado', entregado_en = now()
         WHERE id = $1 AND estado NOT IN ('pagado','cerrado')`,
        [pedido.id]
      );
      const pagado = ['pagado', 'cerrado'].includes(pedido.estado);
      const urlPago = `${PORTAL_URL}/pago.html?pedido=${pedido.id}&correo=${encodeURIComponent(pedido.correo)}`;
      avisarEntregableListo(pedido, urlPago, pagado).catch((e) =>
        console.error('Aviso de entregable:', e.message)
      );
    }
    await logAudit({ usuarioId: req.user.id, entidad: 'entregable', entidadId: ent.id, accion: 'validar' });
    res.json(ent);
  })
);

module.exports = router;
