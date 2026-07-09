const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  publicUser,
  authenticate,
  requireRole,
} = require('../middleware');

const router = express.Router();

const ROLES = ['super_admin', 'lider', 'colaborador', 'visor', 'cliente'];

// Todas las rutas de este módulo exigen super admin.
router.use(authenticate, requireRole('super_admin'));

// GET /api/users
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT id, nombre, email, rol_global, activo, creado_en
       FROM usuario WHERE eliminado_en IS NULL ORDER BY creado_en DESC`
    );
    res.json(rows);
  })
);

// POST /api/users  — crear usuario con rol asignado
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { nombre, email, password, rol_global } = req.body;
    required(req.body, ['nombre', 'email', 'password', 'rol_global']);
    if (!ROLES.includes(rol_global)) throw new AppError(400, 'Rol inválido');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO usuario (nombre, email, password_hash, rol_global)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [nombre, String(email).toLowerCase(), hash, rol_global]
    );
    const user = rows[0];
    await logAudit({ usuarioId: req.user.id, entidad: 'usuario', entidadId: user.id, accion: 'crear' });
    res.status(201).json(publicUser(user));
  })
);

// PATCH /api/users/:id  — actualizar nombre / rol / estado / contraseña
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { nombre, rol_global, activo, password } = req.body;
    if (rol_global && !ROLES.includes(rol_global)) throw new AppError(400, 'Rol inválido');

    const fields = [];
    const values = [];
    let i = 1;
    if (nombre !== undefined) { fields.push(`nombre = $${i++}`); values.push(nombre); }
    if (rol_global !== undefined) { fields.push(`rol_global = $${i++}`); values.push(rol_global); }
    if (activo !== undefined) { fields.push(`activo = $${i++}`); values.push(activo); }
    if (password) { fields.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 10)); }
    if (!fields.length) throw new AppError(400, 'Nada que actualizar');

    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE usuario SET ${fields.join(', ')}
       WHERE id = $${i} AND eliminado_en IS NULL RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError(404, 'Usuario no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'usuario', entidadId: req.params.id, accion: 'actualizar' });
    res.json(publicUser(rows[0]));
  })
);

// DELETE /api/users/:id  — baja lógica
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id)
      throw new AppError(400, 'No puedes eliminar tu propia cuenta');

    const { rows } = await db.query(
      `UPDATE usuario SET eliminado_en = now(), activo = false
       WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError(404, 'Usuario no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'usuario', entidadId: req.params.id, accion: 'eliminar' });
    res.json({ ok: true });
  })
);

module.exports = router;
