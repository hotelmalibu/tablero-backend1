const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { notFound, errorHandler } = require('./middleware');

const app = express();

// CORS: acepta uno o varios orígenes separados por coma (p. ej. con y sin www).
// Ejemplo: CORS_ORIGIN=https://www.midominio.com,https://midominio.com
const origenesPermitidos = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // Sin Origin (curl, apps móviles, health checks) o en la lista permitida.
      if (!origin || origenesPermitidos.includes('*') || origenesPermitidos.includes(origin)) {
        return cb(null, true);
      }
      return cb(new Error('Origen no permitido por CORS: ' + origin));
    },
  })
);
app.use(express.json({ limit: '1mb' }));
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.get('/api/health', (req, res) => res.json({ ok: true, servicio: 'tablero-control-api' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api', require('./routes/milestones'));   // /projects/:id/milestones, /milestones/:id...
app.use('/api', require('./routes/activities'));    // /projects/:id/activities, /activities/:id...
app.use('/api/audit', require('./routes/audit'));
app.use('/api/assistant', require('./routes/assistant'));  // chatbot público con Claude

app.use(notFound);
app.use(errorHandler);

module.exports = app;
