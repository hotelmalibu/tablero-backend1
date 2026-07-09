const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { logAudit } = require('../audit');
const {
  AppError,
  asyncHandler,
  required,
  publicUser,
  signToken,
  authenticate,
} = require('../middleware');

const router = express.Router();

// Limita intentos para frenar fuerza bruta / spam de registro.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos, inténtalo más tarde' },
});

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// POST /api/auth/register  — crea un usuario (rol 'colaborador' por defecto)
router.post(
  '/register',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { nombre, email, password } = req.body;
    required(req.body, ['nombre', 'email', 'password']);
    if (!EMAIL_RE.test(email)) throw new AppError(400, 'Correo inválido');
    if (String(password).length < 6)
      throw new AppError(400, 'La contraseña debe tener al menos 6 caracteres');

    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO usuario (nombre, email, password_hash)
       VALUES ($1, $2, $3) RETURNING *`,
      [nombre, email.toLowerCase(), hash]
    );
    const user = rows[0];
    await logAudit({ usuarioId: user.id, entidad: 'usuario', entidadId: user.id, accion: 'registro' });

    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  })
);

// POST /api/auth/login
router.post(
  '/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    required(req.body, ['email', 'password']);

    const { rows } = await db.query(
      'SELECT * FROM usuario WHERE email = $1 AND eliminado_en IS NULL',
      [String(email).toLowerCase()]
    );
    const user = rows[0];
    const ok = user && (await bcrypt.compare(password, user.password_hash));
    if (!ok) throw new AppError(401, 'Correo o contraseña incorrectos');
    if (!user.activo) throw new AppError(403, 'Tu cuenta está inactiva');

    res.json({ token: signToken(user), user: publicUser(user) });
  })
);

// GET /api/auth/me
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

module.exports = router;
