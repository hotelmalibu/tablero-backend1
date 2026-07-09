const express = require('express');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  authenticate,
  requireRole,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

// Escritura reservada a super admin y líderes.
const canManage = requireRole('super_admin', 'lider');

// GET /api/clients  — cualquier usuario autenticado puede listar
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT * FROM cliente WHERE eliminado_en IS NULL ORDER BY empresa`
    );
    res.json(rows);
  })
);

// POST /api/clients
router.post(
  '/',
  canManage,
  asyncHandler(async (req, res) => {
    const { empresa, contacto_nombre, contacto_email, telefono, notas } = req.body;
    required(req.body, ['empresa']);
    const { rows } = await db.query(
      `INSERT INTO cliente (empresa, contacto_nombre, contacto_email, telefono, notas)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [empresa, contacto_nombre || null, contacto_email || null, telefono || null, notas || null]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'cliente', entidadId: rows[0].id, accion: 'crear' });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/clients/:id
router.patch(
  '/:id',
  canManage,
  asyncHandler(async (req, res) => {
    const allowed = ['empresa', 'contacto_nombre', 'contacto_email', 'telefono', 'notas'];
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    if (!fields.length) throw new AppError(400, 'Nada que actualizar');
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE cliente SET ${fields.join(', ')}
       WHERE id = $${i} AND eliminado_en IS NULL RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError(404, 'Cliente no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'cliente', entidadId: req.params.id, accion: 'actualizar' });
    res.json(rows[0]);
  })
);

// DELETE /api/clients/:id  — baja lógica
router.delete(
  '/:id',
  canManage,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE cliente SET eliminado_en = now()
       WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError(404, 'Cliente no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'cliente', entidadId: req.params.id, accion: 'eliminar' });
    res.json({ ok: true });
  })
);

module.exports = router;
