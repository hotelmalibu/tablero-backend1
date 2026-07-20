const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { notFound, errorHandler } = require('./middleware');

const app = express();

// CORS: uno o varios orígenes separados por coma (con y sin www).
const origenesPermitidos = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || origenesPermitidos.includes('*') || origenesPermitidos.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Origen no permitido por CORS: ' + origin));
    },
  })
);
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'boit-api' }));

// ---------------------------------------------------------------------
//  ORDEN IMPORTANTE
//  1) Rutas públicas y de recurso específico.
//  2) Al final los montajes genéricos en /api, cuyos routers exigen sesión
//     y por lo tanto interceptan cualquier ruta que no se haya resuelto antes.
// ---------------------------------------------------------------------
app.use('/api/assistant', require('./routes/assistant'));   // chatbot público
app.use('/api', require('./routes/pagos'));                 // /pagos/*, /descargas/* (auth por ruta)
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api', require('./routes/pedidos'));               // /catalogo, /pedidos (BOIT)
app.use('/api', require('./routes/milestones'));
app.use('/api', require('./routes/activities'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
