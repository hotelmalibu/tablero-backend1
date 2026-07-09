const express = require('express');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  authenticate,
  requireProjectAccess,
  projectIdFromHito,
} = require('../middleware');

// Montado en /api  → maneja rutas anidadas y de recurso.
const router = express.Router();
router.use(authenticate);

const TIPOS = ['interno', 'cliente'];
const ESTADOS = ['pendiente', 'en_progreso', 'en_riesgo', 'cumplido', 'incumplido'];
const TIPOS_EVIDENCIA = ['archivo', 'enlace', 'nota'];

// GET /api/projects/:projectId/milestones  — lista con resumen de avance
router.get(
  '/projects/:projectId/milestones',
  requireProjectAccess('visor'),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT h.*, r.total_actividades, r.actividades_completas,
              r.actividades_bloqueadas, r.avance_promedio
       FROM hito h
       LEFT JOIN v_hito_resumen r ON r.id = h.id
       WHERE h.proyecto_id = $1 AND h.eliminado_en IS NULL
       ORDER BY COALESCE(h.fecha_compromiso, h.fecha_objetivo_interna) NULLS LAST`,
      [req.projectId]
    );
    res.json(rows);
  })
);

// POST /api/projects/:projectId/milestones  — crear (líder/admin)
router.post(
  '/projects/:projectId/milestones',
  requireProjectAccess('lider'),
  asyncHandler(async (req, res) => {
    const {
      nombre, descripcion, tipo = 'interno',
      fecha_objetivo_interna, fecha_compromiso,
      visible_cliente = false, requiere_evidencia = false,
    } = req.body;
    required(req.body, ['nombre']);
    if (!TIPOS.includes(tipo)) throw new AppError(400, 'Tipo de hito inválido');
    if (tipo === 'cliente' && !fecha_compromiso)
      throw new AppError(400, 'Un hito de cliente requiere fecha de compromiso');

    const { rows } = await db.query(
      `INSERT INTO hito
         (proyecto_id, nombre, descripcion, tipo, fecha_objetivo_interna,
          fecha_compromiso, visible_cliente, requiere_evidencia, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.projectId, nombre, descripcion || null, tipo,
       fecha_objetivo_interna || null, fecha_compromiso || null,
       visible_cliente, requiere_evidencia, req.user.id]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'hito', entidadId: rows[0].id, accion: 'crear' });
    res.status(201).json(rows[0]);
  })
);

// PATCH /api/milestones/:id  — actualizar
router.patch(
  '/milestones/:id',
  requireProjectAccess('lider', projectIdFromHito),
  asyncHandler(async (req, res) => {
    const allowed = ['nombre', 'descripcion', 'tipo', 'estado', 'fecha_objetivo_interna',
      'fecha_compromiso', 'visible_cliente', 'requiere_evidencia'];
    if (req.body.estado && !ESTADOS.includes(req.body.estado))
      throw new AppError(400, 'Estado inválido');
    if (req.body.tipo && !TIPOS.includes(req.body.tipo))
      throw new AppError(400, 'Tipo inválido');

    const fields = [];
    const values = [];
    let i = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) { fields.push(`${key} = $${i++}`); values.push(req.body[key]); }
    }
    if (!fields.length) throw new AppError(400, 'Nada que actualizar');
    values.push(req.params.id);
    const { rows } = await db.query(
      `UPDATE hito SET ${fields.join(', ')}
       WHERE id = $${i} AND eliminado_en IS NULL RETURNING *`,
      values
    );
    if (!rows[0]) throw new AppError(404, 'Hito no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'hito', entidadId: req.params.id, accion: 'actualizar' });
    res.json(rows[0]);
  })
);

// POST /api/milestones/:id/approve  — gate de aprobación
// Si el hito requiere evidencia, debe existir al menos una antes de aprobar.
router.post(
  '/milestones/:id/approve',
  requireProjectAccess('lider', projectIdFromHito),
  asyncHandler(async (req, res) => {
    const { rows: hitoRows } = await db.query(
      'SELECT * FROM hito WHERE id = $1 AND eliminado_en IS NULL',
      [req.params.id]
    );
    const hito = hitoRows[0];
    if (!hito) throw new AppError(404, 'Hito no encontrado');

    if (hito.requiere_evidencia) {
      const { rows: ev } = await db.query(
        'SELECT COUNT(*)::int AS n FROM evidencia WHERE hito_id = $1',
        [req.params.id]
      );
      if (ev[0].n === 0)
        throw new AppError(400, 'Este hito requiere evidencia adjunta antes de aprobarse');
    }

    const { rows } = await db.query(
      `UPDATE hito SET estado = 'cumplido', aprobado_por = $1, aprobado_en = now()
       WHERE id = $2 RETURNING *`,
      [req.user.id, req.params.id]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'hito', entidadId: req.params.id, accion: 'aprobar' });
    res.json(rows[0]);
  })
);

// DELETE /api/milestones/:id  — baja lógica
router.delete(
  '/milestones/:id',
  requireProjectAccess('lider', projectIdFromHito),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE hito SET eliminado_en = now()
       WHERE id = $1 AND eliminado_en IS NULL RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) throw new AppError(404, 'Hito no encontrado');
    await logAudit({ usuarioId: req.user.id, entidad: 'hito', entidadId: req.params.id, accion: 'eliminar' });
    res.json({ ok: true });
  })
);

// ---- Evidencia del hito --------------------------------------------

// GET /api/milestones/:id/evidence
router.get(
  '/milestones/:id/evidence',
  requireProjectAccess('visor', projectIdFromHito),
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `SELECT e.*, u.nombre AS subido_por_nombre
       FROM evidencia e LEFT JOIN usuario u ON u.id = e.subido_por
       WHERE e.hito_id = $1 ORDER BY e.creado_en DESC`,
      [req.params.id]
    );
    res.json(rows);
  })
);

// POST /api/milestones/:id/evidence  — adjuntar evidencia (referencia/URL)
router.post(
  '/milestones/:id/evidence',
  requireProjectAccess('colaborador', projectIdFromHito),
  asyncHandler(async (req, res) => {
    const { tipo = 'enlace', url, descripcion } = req.body;
    if (!TIPOS_EVIDENCIA.includes(tipo)) throw new AppError(400, 'Tipo de evidencia inválido');
    const { rows } = await db.query(
      `INSERT INTO evidencia (hito_id, tipo, url, descripcion, subido_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.params.id, tipo, url || null, descripcion || null, req.user.id]
    );
    await logAudit({ usuarioId: req.user.id, entidad: 'evidencia', entidadId: rows[0].id, accion: 'crear', detalle: { hito_id: req.params.id } });
    res.status(201).json(rows[0]);
  })
);

module.exports = router;
