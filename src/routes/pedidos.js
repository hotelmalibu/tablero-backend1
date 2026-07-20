const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { logAudit } = require('../audit');
const { avisarPedidoNuevo, confirmarAlCliente } = require('../mailer');
const {
  AppError,
  asyncHandler,
  required,
  authenticate,
  requireRole,
} = require('../middleware');

const router = express.Router();

const IVA = 0.19;
const ESTADOS = ['nuevo','asignado','en_produccion','en_validacion','entregado','pagado','cerrado','cancelado'];

// Quiénes pueden ver/gestionar todos los pedidos
const ADMINES = ['super_admin', 'lider'];
// Quiénes producen
const PRODUCTORES = ['gestor', 'investigador'];

// =====================================================================
//  CATÁLOGO (público)
// =====================================================================
// GET /api/catalogo  ?categoria=ambiental
router.get(
  '/catalogo',
  asyncHandler(async (req, res) => {
    const filtros = ['activo = true'];
    const values = [];
    if (req.query.categoria) {
      values.push(req.query.categoria);
      filtros.push(`categoria = $${values.length}`);
    }
    const { rows } = await db.query(
      `SELECT id, slug, nombre, categoria, resumen, descripcion, incluye,
              precio_desde_usd, dias_entrega, icono, destacado
       FROM servicio WHERE ${filtros.join(' AND ')}
       ORDER BY destacado DESC, orden, nombre`,
      values
    );
    res.json(rows);
  })
);

// =====================================================================
//  CREAR PEDIDO (público — el cliente no necesita cuenta)
// =====================================================================
const pedidoLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10, // 10 pedidos cada 10 min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Inténtelo de nuevo en unos minutos.' },
});

// POST /api/pedidos
// body: { nombre, entidad, correo, telefono, descripcion, items:[{servicio_id, cantidad, especificaciones}], website }
router.post(
  '/pedidos',
  pedidoLimiter,
  asyncHandler(async (req, res) => {
    // Honeypot anti-spam: si el campo oculto viene lleno, fingimos éxito.
    if (req.body.website) return res.status(201).json({ ok: true });

    const { nombre, entidad, correo, telefono, descripcion, items } = req.body;
    required(req.body, ['nombre', 'correo']);
    if (!Array.isArray(items) || items.length === 0) {
      throw new AppError(400, 'Debe seleccionar al menos un servicio');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) {
      throw new AppError(400, 'Correo inválido');
    }

    // Los precios SIEMPRE salen de la base de datos, nunca del cliente.
    const ids = items.map((i) => i.servicio_id).filter(Boolean);
    if (!ids.length) throw new AppError(400, 'Servicios inválidos');
    const { rows: servicios } = await db.query(
      'SELECT id, nombre, precio_desde_usd FROM servicio WHERE id = ANY($1::uuid[]) AND activo = true',
      [ids]
    );
    if (!servicios.length) throw new AppError(400, 'Los servicios seleccionados no están disponibles');
    const porId = new Map(servicios.map((s) => [s.id, s]));

    const renglones = [];
    let subtotal = 0;
    for (const it of items) {
      const s = porId.get(it.servicio_id);
      if (!s) continue;
      const cantidad = Math.max(1, Math.min(99, parseInt(it.cantidad, 10) || 1));
      const precio = Number(s.precio_desde_usd);
      subtotal += precio * cantidad;
      renglones.push({
        servicio_id: s.id,
        nombre_servicio: s.nombre,
        cantidad,
        precio_unit_usd: precio,
        especificaciones: (it.especificaciones || '').slice(0, 2000) || null,
      });
    }
    if (!renglones.length) throw new AppError(400, 'Los servicios seleccionados no están disponibles');

    const iva = +(subtotal * IVA).toFixed(2);
    const total = +(subtotal + iva).toFixed(2);

    const pedido = await db.tx(async (client) => {
      const { rows: fol } = await client.query('SELECT siguiente_folio_pedido() AS folio');
      const folio = fol[0].folio;
      const { rows } = await client.query(
        `INSERT INTO pedido (folio, cliente_id, nombre, entidad, correo, telefono,
                             subtotal_usd, iva_usd, total_usd, descripcion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          folio,
          req.user ? req.user.id : null,
          nombre, entidad || null, String(correo).toLowerCase(), telefono || null,
          subtotal.toFixed(2), iva, total, (descripcion || '').slice(0, 5000) || null,
        ]
      );
      const p = rows[0];
      for (const r of renglones) {
        await client.query(
          `INSERT INTO pedido_item (pedido_id, servicio_id, nombre_servicio, cantidad, precio_unit_usd, especificaciones)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [p.id, r.servicio_id, r.nombre_servicio, r.cantidad, r.precio_unit_usd, r.especificaciones]
        );
      }
      await logAudit({ usuarioId: null, entidad: 'pedido', entidadId: p.id, accion: 'crear' }, client);
      return p;
    });

    // Notificaciones: nunca bloquean la respuesta al cliente.
    (async () => {
      try {
        const { rows: internos } = await db.query(
          `SELECT email FROM usuario
           WHERE rol_global IN ('super_admin','lider') AND activo AND eliminado_en IS NULL`
        );
        await avisarPedidoNuevo(pedido, renglones, internos.map((u) => u.email));
        await confirmarAlCliente(pedido);
      } catch (e) {
        console.error('Aviso de pedido:', e.message);
      }
    })();

    res.status(201).json({ ok: true, folio: pedido.folio, id: pedido.id, total_usd: pedido.total_usd });
  })
);

// =====================================================================
//  A PARTIR DE AQUÍ: TODO REQUIERE SESIÓN
// =====================================================================
router.use(authenticate);

// GET /api/pedidos — alcance según el rol
router.get(
  '/pedidos',
  asyncHandler(async (req, res) => {
    const rol = req.user.rol_global;
    const filtros = ['p.eliminado_en IS NULL'];
    const values = [];

    if (ADMINES.includes(rol)) {
      // ve todos
    } else if (PRODUCTORES.includes(rol)) {
      values.push(req.user.id);
      filtros.push(`(p.asignado_a = $${values.length} OR p.apoyo_id = $${values.length})`);
    } else {
      // cliente: solo los suyos (por cuenta o por correo)
      values.push(req.user.id, req.user.email);
      filtros.push(`(p.cliente_id = $${values.length - 1} OR p.correo = $${values.length})`);
    }
    if (req.query.estado && ESTADOS.includes(req.query.estado)) {
      values.push(req.query.estado);
      filtros.push(`p.estado = $${values.length}`);
    }

    const { rows } = await db.query(
      `SELECT p.*, g.nombre AS gestor_nombre, i.nombre AS apoyo_nombre,
              (SELECT COUNT(*) FROM entregable e WHERE e.pedido_id = p.id) AS total_entregables
       FROM pedido p
       LEFT JOIN usuario g ON g.id = p.asignado_a
       LEFT JOIN usuario i ON i.id = p.apoyo_id
       WHERE ${filtros.join(' AND ')}
       ORDER BY p.creado_en DESC`,
      values
    );
    res.json(rows);
  })
);

// GET /api/pedidos/:id — detalle con renglones y entregables
router.get(
  '/pedidos/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'SELECT * FROM pedido WHERE id = $1 AND eliminado_en IS NULL',
      [req.params.id]
    );
    const p = rows[0];
    if (!p) throw new AppError(404, 'Pedido no encontrado');

    const rol = req.user.rol_global;
    const esSuyo =
      ADMINES.includes(rol) ||
      p.asignado_a === req.user.id ||
      p.apoyo_id === req.user.id ||
      p.cliente_id === req.user.id ||
      p.correo === req.user.email;
    if (!esSuyo) throw new AppError(403, 'No tiene permisos sobre este pedido');

    const { rows: items } = await db.query(
      'SELECT * FROM pedido_item WHERE pedido_id = $1',
      [p.id]
    );
    const { rows: entregables } = await db.query(
      `SELECT id, nombre, descripcion, tipo, version, producido_por, validado_en, creado_en,
              CASE WHEN p2.estado IN ('pagado','cerrado') THEN token_descarga ELSE NULL END AS token_descarga
       FROM entregable e JOIN pedido p2 ON p2.id = e.pedido_id
       WHERE e.pedido_id = $1 ORDER BY e.creado_en`,
      [p.id]
    );
    res.json({ ...p, items, entregables });
  })
);

// PATCH /api/pedidos/:id — asignar / cambiar estado
router.patch(
  '/pedidos/:id',
  asyncHandler(async (req, res) => {
    const rol = req.user.rol_global;
    const { rows: act } = await db.query(
      'SELECT * FROM pedido WHERE id = $1 AND eliminado_en IS NULL',
      [req.params.id]
    );
    const actual = act[0];
    if (!actual) throw new AppError(404, 'Pedido no encontrado');

    const esAdmin = ADMINES.includes(rol);
    const esAsignado = actual.asignado_a === req.user.id || actual.apoyo_id === req.user.id;
    if (!esAdmin && !esAsignado) throw new AppError(403, 'No tiene permisos sobre este pedido');

    // Solo super admin y líder asignan; los productores solo mueven el estado.
    const permitidos = esAdmin
      ? ['estado', 'asignado_a', 'apoyo_id', 'agente_virtual', 'notas_internas', 'fecha_limite',
         'subtotal_usd', 'iva_usd', 'total_usd']
      : ['estado', 'agente_virtual', 'notas_internas'];

    if (req.body.estado && !ESTADOS.includes(req.body.estado)) {
      throw new AppError(400, 'Estado inválido');
    }
    // El paso a 'pagado' lo hace únicamente el webhook de la pasarela.
    if (req.body.estado === 'pagado') {
      throw new AppError(400, 'El estado "pagado" lo confirma la pasarela de pago');
    }

    const campos = [];
    const values = [];
    for (const k of permitidos) {
      if (req.body[k] !== undefined) {
        values.push(req.body[k] === '' ? null : req.body[k]);
        campos.push(`${k} = $${values.length}`);
      }
    }
    if (!campos.length) throw new AppError(400, 'Nada que actualizar');
    if (req.body.estado === 'entregado') campos.push('entregado_en = now()');

    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE pedido SET ${campos.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    await logAudit({
      usuarioId: req.user.id, entidad: 'pedido', entidadId: req.params.id,
      accion: req.body.estado ? 'cambiar_estado' : 'actualizar',
      detalle: req.body.estado ? { estado: req.body.estado } : null,
    });
    res.json(rows[0]);
  })
);

// =====================================================================
//  CATÁLOGO — administración (solo super admin)
// =====================================================================
router.post(
  '/catalogo',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { slug, nombre, categoria, resumen, descripcion, incluye,
            precio_desde_usd, dias_entrega, icono, destacado, orden } = req.body;
    required(req.body, ['slug', 'nombre', 'categoria']);
    const { rows } = await db.query(
      `INSERT INTO servicio (slug, nombre, categoria, resumen, descripcion, incluye,
                             precio_desde_usd, dias_entrega, icono, destacado, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [slug, nombre, categoria, resumen || null, descripcion || null,
       JSON.stringify(incluye || []), precio_desde_usd || 0, dias_entrega || 10,
       icono || null, !!destacado, orden || 100]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'servicio', entidadId: rows[0].id, accion: 'crear' });
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/catalogo/:id',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const permitidos = ['nombre','categoria','resumen','descripcion','incluye',
                        'precio_desde_usd','dias_entrega','icono','destacado','activo','orden'];
    const campos = [];
    const values = [];
    for (const k of permitidos) {
      if (req.body[k] !== undefined) {
        values.push(k === 'incluye' ? JSON.stringify(req.body[k]) : req.body[k]);
        campos.push(`${k} = $${values.length}`);
      }
    }
    if (!campos.length) throw new AppError(400, 'Nada que actualizar');
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE servicio SET ${campos.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError(404, 'Servicio no encontrado');
    res.json(rows[0]);
  })
);

module.exports = router;
