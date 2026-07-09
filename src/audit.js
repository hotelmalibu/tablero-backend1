// [RECONSTRUIDO para la revisión] Este módulo helper FALTA en la entrega original.
// Escribe una entrada en la bitácora. Acepta un `client` opcional para
// participar en una transacción en curso (ver projects.js:67).
const db = require('./db');

async function logAudit(
  { usuarioId = null, entidad, entidadId = null, accion, detalle = null },
  client
) {
  const text = `INSERT INTO bitacora (usuario_id, entidad, entidad_id, accion, detalle)
                VALUES ($1, $2, $3, $4, $5)`;
  const params = [
    usuarioId,
    entidad,
    entidadId,
    accion,
    detalle ? JSON.stringify(detalle) : null,
  ];
  const runner = client || db;
  return runner.query(text, params);
}

module.exports = { logAudit };
