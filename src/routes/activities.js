const express = require('express');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  authenticate,
  requireProjectAccess,
  projectIdFromActividad,
} = require('../middleware');

// Montado en /api
const router = express.Router();
router.use(authenticate);

const ESTADOS = ['sin_iniciar', 'en_progreso', 'en_revision', 'bloqueado', 'completo'];

// GET /api/projects/:projectId/activities  — lista con filtros opcionales
// ?estado=&responsable_id=&hito_id=
router.get(
  '/projects/:projectId/activities',
  requireProjectAccess('visor'),
  asyncHandler(async (req, res) => {
    const filtros = ['a.proyecto_id = $1', 'a.eliminado_en IS NULL'];
    const values = [req.projectId];
    let i = 2;
    if (req.query.estado) { filtros.push(`a.estado = $${i++}`); values.push(req.query.estado); }
    if (req.query.responsable_id) { filtros.push(`a.responsable_id = $${i++}`); values.push(req.query.responsable_id); }
    if (req.query.hito_id) { filtros.push(`a.hito_id = $${i++}`); values.push(req.query.hito_id); }

    const { rows } = await db.query(
      `SELECT a.*, u.nombre AS responsable_nombre, h.nombre AS hito_nombre
       FROM actividad a
       LEFT JOIN usuario u ON u.id = a.responsable_id
       LEFT JOIN hito h ON h.id = a.hito_id
       WHERE ${filtros.join(' AND ')}
       ORDER BY a.fecha_fin NULLS LAST, a.prioridad`,
      values
    );
    res.json(rows);
  })
);

// POST /api/projects/:projectId/activities  — crear (colaborador o superior)
router.post(
  '/projects/:projectId/activities',
  requireProjectAccess('colaborador'),
  asyncHandler(async (req, res) => {
    const {
      titulo, descripcion, producto, hito_id, responsable_id,
      estado = 'sin_iniciar', avance = 0, prioridad = 2,
      fecha_inicio, fecha_fin,
    } = req.body;
    required(req.body, ['titulo']);
    if (!ESTADOS.includes(estado)) throw new AppError(400, 'Estado inválido');

    const { rows } = await db.query(
      `INSERT INTO actividad
         (proyecto_id, hito_id, titulo, descripcion, producto, responsable_id,
          estado, avance, prioridad, fecha_inicio, fecha_fin, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [req.projectId, hito_id || null, titulo, descripcion || null, producto || null,
       responsable_id || null, estado, avance, prioridad,
       fecha_inicio || null, fecha_fin || null, req.user.id]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'actividad', entidadId: rows[0].id, accion: 'crear' });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/activities/:id  — actualizar / cambiar estado / reportar avance
router.patch(
  '/activities/:id',
  requireProjectAccess('colaborador', projectIdFromActividad),
  asyncHandler(async (req, res) => {
    const allowed = ['titulo', 'descripcion', 'producto', 'hito_id', 'responsable_id',
      'estado', 'avance', 'prioridad', 'fecha_inicio', 'fecha_fin'];
    if (req.body.estado && !ESTADOS.includes(req.body.estado))
      throw new AppError(400, 'Estado inválido');

    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    // Coherencia: si se marca completo, el avance pasa a 100.
    if (req.body.estado === 'completo' && req.body.avance === undefined) {
      fields.push(`avance = $${i++}`); values.push(100);
    }
    if (!fields.length) throw new AppError(400, 'Nada que actualizar');
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE actividad SET ${fields.join(', ')}
       WHERE id = $${i} AND eliminado_en IS NULL RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError(404, 'Actividad no encontrada');
    await logAudit({
      usuarioId: req.user.id, entidad: 'actividad', entidadId: req.params.id,
      accion: req.body.estado ? 'cambiar_estado' : 'actualizar',
      detalle: req.body.estado ? { estado: req.body.estado } : null,
    });
    res.json(rows[0]);
  })
);

// DELETE /api/activities/:id  — baja lógica
router.delete(
  '/activities/:id',
  requireProjectAccess('colaborador', projectIdFromActividad),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE actividad SET eliminado_en = now()
       WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError(404, 'Actividad no encontrada');
    await logAudit({ usuarioId: req.user.id, entidad: 'actividad', entidadId: req.params.id, accion: 'eliminar' });
    res.json({ ok: true });
  })
);

// ---- Comentarios de la actividad -----------------------------------

// GET /api/activities/:id/comments
router.get(
  '/activities/:id/comments',
  requireProjectAccess('visor', projectIdFromActividad),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT c.*, u.nombre AS autor_nombre
       FROM comentario c LEFT JOIN usuario u ON u.id = c.autor_id
       WHERE c.actividad_id = $1 ORDER BY c.creado_en`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// POST /api/activities/:id/comments  — cualquier miembro (incl. visor) puede comentar
router.post(
  '/activities/:id/comments',
  requireProjectAccess('visor', projectIdFromActividad),
  asyncHandler(async (req, res) => {
    const { texto } = req.body;
    required(req.body, ['texto']);
    const { rows } = await db.query(
      `INSERT INTO comentario (actividad_id, autor_id, texto)
       VALUES ($1, $2, $3) RETURNING *`,
      [req.params.id, req.user.id, texto]
    );
    res.status(201).json({ ...rows[0], autor_nombre: req.user.nombre });
  })
);

// ---- Evidencia de la actividad -------------------------------------

// POST /api/activities/:id/evidence
router.post(
  '/activities/:id/evidence',
  requireProjectAccess('colaborador', projectIdFromActividad),
  asyncHandler(async (req, res) => {
    const { tipo = 'enlace', url, descripcion } = req.body;
    const { rows } = await db.query(
      `INSERT INTO evidencia (actividad_id, tipo, url, descripcion, subido_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, tipo, url || null, descripcion || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  })
);

module.exports = router;
