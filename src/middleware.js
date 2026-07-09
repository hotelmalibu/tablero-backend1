const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

// ---------------------------------------------------------------------
// Errores y utilidades
// ---------------------------------------------------------------------
class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Envuelve handlers async para que los errores lleguen al errorHandler.
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Valida que estén presentes los campos requeridos.
function required(obj, fields) {
  const missing = fields.filter(
    (f) => obj[f] === undefined || obj[f] === null || obj[f] === ''
  );
  if (missing.length) {
    throw new AppError(400, `Faltan campos obligatorios: ${missing.join(', ')}`);
  }
}

// Quita datos sensibles antes de devolver un usuario.
function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...safe } = row;
  return safe;
}

function signToken(user) {
  return jwt.sign({ sub: user.id, rol: user.rol_global }, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });
}

// ---------------------------------------------------------------------
// Autenticación: verifica el JWT y carga el usuario
// ---------------------------------------------------------------------
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new AppError(401, 'Falta el token de autenticación');

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    throw new AppError(401, 'Token inválido o expirado');
  }

  const { rows } = await db.query(
    'SELECT * FROM usuario WHERE id = $1 AND eliminado_en IS NULL',
    [payload.sub]
  );
  const user = rows[0];
  if (!user || !user.activo) {
    throw new AppError(401, 'Usuario no encontrado o inactivo');
  }
  req.user = user;
  next();
});

// ---------------------------------------------------------------------
// Autorización por rol global
// ---------------------------------------------------------------------
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol_global)) {
      return next(new AppError(403, 'No tienes permisos para esta acción'));
    }
    next();
  };
}

// ---------------------------------------------------------------------
// Autorización con alcance por proyecto (RBAC)
// El rol global fija el techo; la membresía define sobre qué proyecto.
// ---------------------------------------------------------------------
const ROLE_RANK = { visor: 1, colaborador: 2, lider: 3 };

// Devuelve el rol efectivo del usuario en un proyecto ('lider'|'colaborador'|'visor'|null)
async function getProjectRole(user, projectId) {
  if (!projectId) return null;
  if (user.rol_global === 'super_admin') return 'lider'; // acceso total
  const { rows } = await db.query(
    'SELECT rol_proyecto FROM miembro_proyecto WHERE usuario_id = $1 AND proyecto_id = $2',
    [user.id, projectId]
  );
  return rows[0] ? rows[0].rol_proyecto : null;
}

// Factory: exige al menos `minRole` sobre el proyecto que resuelva `getProjectId(req)`.
// `getProjectId` puede ser async (p. ej. para resolver el proyecto de un hito o actividad).
function requireProjectAccess(minRole, getProjectId = (req) => req.params.projectId) {
  return asyncHandler(async (req, res, next) => {
    const projectId = await getProjectId(req);
    if (!projectId) throw new AppError(404, 'Proyecto no encontrado');

    const role = await getProjectRole(req.user, projectId);
    if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
      throw new AppError(403, 'No tienes permisos sobre este proyecto');
    }
    req.projectId = projectId;
    req.projectRole = role;
    next();
  });
}

// ---------------------------------------------------------------------
// Resolvers de proyecto para recursos anidados
// ---------------------------------------------------------------------
async function projectIdFromHito(req) {
  const { rows } = await db.query(
    'SELECT proyecto_id FROM hito WHERE id = $1 AND eliminado_en IS NULL',
    [req.params.id]
  );
  return rows[0] ? rows[0].proyecto_id : null;
}

async function projectIdFromActividad(req) {
  const { rows } = await db.query(
    'SELECT proyecto_id FROM actividad WHERE id = $1 AND eliminado_en IS NULL',
    [req.params.id]
  );
  return rows[0] ? rows[0].proyecto_id : null;
}

// ---------------------------------------------------------------------
// 404 y manejador central de errores
// ---------------------------------------------------------------------
function notFound(req, res) {
  res.status(404).json({ error: 'Ruta no encontrada' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  // Violaciones de restricción de PostgreSQL → mensajes claros
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Ya existe un registro con ese valor único' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referencia inválida a un registro inexistente' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Los datos no cumplen una restricción del modelo' });
  }
  res.status(status).json({ error: err.message || 'Error interno del servidor' });
}

module.exports = {
  AppError,
  asyncHandler,
  required,
  publicUser,
  signToken,
  authenticate,
  requireRole,
  requireProjectAccess,
  getProjectRole,
  projectIdFromHito,
  projectIdFromActividad,
  notFound,
  errorHandler,
};
