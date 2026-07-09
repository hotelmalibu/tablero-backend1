const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const { notFound, errorHandler } = require('./middleware');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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

app.use(notFound);
app.use(errorHandler);

module.exports = app;
