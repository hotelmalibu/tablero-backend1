const express = require('express');
const db = require('../db');
const { asyncHandler, authenticate, requireRole } = require('../middleware');

const router = express.Router();
router.use(authenticate, requireRole('super_admin'));

// GET /api/audit?entidad=&entidad_id=&limit=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filtros = [];
    const values = [];
    let i = 1;
    if (req.query.entidad) { filtros.push(`b.entidad = $${i++}`); values.push(req.query.entidad); }
    if (req.query.entidad_id) { filtros.push(`b.entidad_id = $${i++}`); values.push(req.query.entidad_id); }
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    values.push(limit);

    const { rows } = await db.query(
      `SELECT b.*, u.nombre AS usuario_nombre
       FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id
       ${where}
       ORDER BY b.creado_en DESC
       LIMIT $${i}`,
      values
    );
    res.json(rows);
  })
);

module.exports = router;
