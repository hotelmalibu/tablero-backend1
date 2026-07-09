const express = require('express');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  authenticate,
  requireRole,
  requireProjectAccess,
} = require('../middleware');

const router = express.Router();
router.use(authenticate);

const ROLES_PROYECTO = ['lider', 'colaborador', 'visor'];
const ESTADOS = ['activo', 'en_pausa', 'cerrado'];

// GET /api/projects  — listado con alcance:
// super admin ve todos; el resto ve solo los proyectos donde es miembro.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const esAdmin = req.user.rol_global === 'super_admin';
    const { rows } = await db.query(
      `SELECT p.*, c.empresa AS cliente_empresa, u.nombre AS lider_nombre,
              (SELECT COUNT(*) FROM actividad a WHERE a.proyecto_id = p.id AND a.eliminado_en IS NULL) AS total_actividades,
              (SELECT COUNT(*) FROM hito h WHERE h.proyecto_id = p.id AND h.eliminado_en IS NULL) AS total_hitos
       FROM proyecto p
       LEFT JOIN cliente c ON c.id = p.cliente_id
       LEFT JOIN usuario u ON u.id = p.lider_id
       WHERE p.eliminado_en IS NULL
         AND ($1 OR EXISTS (
           SELECT 1 FROM miembro_proyecto m
           WHERE m.proyecto_id = p.id AND m.usuario_id = $2))
       ORDER BY p.creado_en DESC`,
      [esAdmin, req.user.id]
    );
    res.json(rows);
  })
);

// POST /api/projects  — crear (super admin o líder)
router.post(
  '/',
  requireRole('super_admin', 'lider'),
  asyncHandler(async (req, res) => {
    const { nombre, descripcion, cliente_id, lider_id, fecha_inicio, fecha_fin_estimada } = req.body;
    required(req.body, ['nombre']);
    const liderFinal = lider_id || req.user.id;

    const proyecto = await db.tx(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO proyecto (nombre, descripcion, cliente_id, lider_id, fecha_inicio, fecha_fin_estimada, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [nombre, descripcion || null, cliente_id || null, liderFinal,
         fecha_inicio || null, fecha_fin_estimada || null, req.user.id]
      );
      const p = rows[0];
      // El líder queda como miembro con rol 'lider'.
      await client.query(
        `INSERT INTO miembro_proyecto (usuario_id, proyecto_id, rol_proyecto)
         VALUES ($1, $2, 'lider')
         ON CONFLICT (usuario_id, proyecto_id) DO UPDATE SET rol_proyecto = 'lider'`,
        [liderFinal, p.id]
      );
      await logAudit({ usuarioId: req.user.id, entidad: 'proyecto', entidadId: p.id, accion: 'crear' }, client);
      return p;
    });
    res.status(201).json(proyecto);
  })
);

// GET /api/projects/:projectId  — detalle + miembros
router.get(
  '/:projectId',
  requireProjectAccess('visor'),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT p.*, c.empresa AS cliente_empresa
       FROM proyecto p LEFT JOIN cliente c ON c.id = p.cliente_id
       WHERE p.id = $1 AND p.eliminado_en IS NULL`,
      [req.projectId]
    );
    if (!rows[0]) throw new AppError(404, 'Proyecto no encontrado');
    const { rows: miembros } = await db.query(
      `SELECT m.usuario_id, m.rol_proyecto, u.nombre, u.email
       FROM miembro_proyecto m JOIN usuario u ON u.id = m.usuario_id
       WHERE m.proyecto_id = $1 ORDER BY u.nombre`,
      [req.projectId]
    );
    res.json({ ...rows[0], mi_rol: req.projectRole, miembros });
  })
);

// PATCH /api/projects/:projectId  — actualizar (líder del proyecto o admin)
router.patch(
  '/:projectId',
  requireProjectAccess('lider'),
  asyncHandler(async (req, res) => {
    const allowed = ['nombre', 'descripcion', 'cliente_id', 'lider_id', 'estado', 'fecha_inicio', 'fecha_fin_estimada'];
    if (req.body.estado && !ESTADOS.includes(req.body.estado))
      throw new AppError(400, 'Estado inválido');
    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key] || null); }
    }
    if (!fields.length) throw new AppError(400, 'Nada que actualizar');
    values.push(req.projectId);
    const { rows } = await db.query(
      `UPDATE proyecto SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'proyecto', entidadId: req.projectId, accion: 'actualizar' });
    res.json(rows[0]);
  })
);

// DELETE /api/projects/:projectId  — baja lógica (solo super admin)
router.delete(
  '/:projectId',
  requireRole('super_admin'),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE proyecto SET eliminado_en = now()
       WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
      [req.params.projectId]
    );
    if (!rows[0]) throw new AppError(404, 'Proyecto no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'proyecto', entidadId: req.params.projectId, accion: 'eliminar' });
    res.json({ ok: true });
  })
);

// ---- Miembros del proyecto -----------------------------------------

// GET /api/projects/:projectId/members
router.get(
  '/:projectId/members',
  requireProjectAccess('visor'),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT m.usuario_id, m.rol_proyecto, m.creado_en, u.nombre, u.email
       FROM miembro_proyecto m JOIN usuario u ON u.id = m.usuario_id
       WHERE m.proyecto_id = $1 ORDER BY u.nombre`,
      [req.projectId]
    );
    res.json(rows);
  })
);

// POST /api/projects/:projectId/members  — agregar / actualizar miembro
router.post(
  '/:projectId/members',
  requireProjectAccess('lider'),
  asyncHandler(async (req, res) => {
    const { usuario_id, rol_proyecto } = req.body;
    required(req.body, ['usuario_id', 'rol_proyecto']);
    if (!ROLES_PROYECTO.includes(rol_proyecto)) throw new AppError(400, 'Rol de proyecto inválido');
    const { rows } = await db.query(
      `INSERT INTO miembro_proyecto (usuario_id, proyecto_id, rol_proyecto)
       VALUES ($1, $2, $3)
       ON CONFLICT (usuario_id, proyecto_id) DO UPDATE SET rol_proyecto = EXCLUDED.rol_proyecto
       RETURNING *`,
      [usuario_id, req.projectId, rol_proyecto]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'miembro_proyecto', entidadId: req.projectId, accion: 'asignar', detalle: { usuario_id, rol_proyecto } });
    res.status(201).json(rows[0]);
  })
);

// DELETE /api/projects/:projectId/members/:userId
router.delete(
  '/:projectId/members/:userId',
  requireProjectAccess('lider'),
  asyncHandler(async (req, res) => {
    await db.query(
      'DELETE FROM miembro_proyecto WHERE proyecto_id = $1 AND usuario_id = $2',
      [req.projectId, req.params.userId]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'miembro_proyecto', entidadId: req.projectId, accion: 'quitar', detalle: { usuario_id: req.params.userId } });
    res.json({ ok: true });
  })
);

module.exports = router;
