require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

(async () => {
  const nombre = process.env.ADMIN_NOMBRE || 'Administrador';
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('Define ADMIN_EMAIL y ADMIN_PASSWORD en el archivo .env');
    process.exitCode = 1;
    return db.pool.end();
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      `INSERT INTO usuario (nombre, email, password_hash, rol_global)
       VALUES ($1, $2, $3, 'super_admin')
       ON CONFLICT (email) DO UPDATE
         SET rol_global = 'super_admin', password_hash = EXCLUDED.password_hash, activo = true
       RETURNING id, nombre, email, rol_global`,
      [nombre, email, hash]
    );
    console.log('Super admin listo:', rows[0]);
  } catch (err) {
    console.error('Error al crear el super admin:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
