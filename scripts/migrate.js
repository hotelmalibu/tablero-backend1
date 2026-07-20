require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

// Esquemas y semillas a aplicar, en orden. Todos son idempotentes.
const ARCHIVOS = [
  '../db/schema.sql',                  // tablero de control (base)
  '../db/schema-boit.sql',             // portal BOIT: catálogo, pedidos, entregables, pagos
  '../db/seed-catalogo.sql',           // catálogo: documentos y proyectos
  '../db/seed-catalogo-servicios.sql', // catálogo: servicios de servicios.html
];

(async () => {
  try {
    for (const rel of ARCHIVOS) {
      const ruta = path.join(__dirname, rel);
      if (!fs.existsSync(ruta)) {
        console.log('· Omitido (no existe):', rel);
        continue;
      }
      const sql = fs.readFileSync(ruta, 'utf8');
      await db.pool.query(sql);
      console.log('· Aplicado:', rel);
    }
    console.log('Esquema aplicado correctamente.');
  } catch (err) {
    console.error('Error al aplicar el esquema:', err.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
