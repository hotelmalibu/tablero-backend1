const { Pool } = require('pg');

// SSL: las bases gestionadas en la nube (Neon, Render, Supabase, Railway, Heroku…)
// exigen TLS. Se activa si la cadena lo pide (sslmode=require), si el host es de un
// proveedor conocido, o si defines PGSSL=true. En local (Postgres sin SSL) queda apagado.
const url = process.env.DATABASE_URL || '';
const usarSSL =
  process.env.PGSSL === 'true' ||
  /sslmode=require/i.test(url) ||
  /neon\.tech|render\.com|supabase\.(co|com)|railway\.app|rlwy\.net|amazonaws\.com|herokuapp\.com/i.test(url);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  ...(usarSSL ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

// Query simple contra el pool
function query(text, params) {
  return pool.query(text, params);
}

// Ejecuta una función dentro de una transacción; hace COMMIT o ROLLBACK.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, tx };
