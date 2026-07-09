require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
    await db.pool.query(sql);
    console.log('Esquema aplicado correctamente.');
  } catch (err) {
    console.error('Error al aplicar el esquema:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
