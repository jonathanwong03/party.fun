import 'dotenv/config';
import express from 'express';
import organiserRoutes from './routes/organiserRoutes.js';
import checkoutRoutes from './routes/checkoutRoutes.js';
import confirmationRoutes from './routes/confirmationRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import userRoutes from './routes/userRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';
import passwordResetRoutes from './routes/passwordResetRoutes.js';

const app = express();
const PORT = process.env.API_PORT || process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'party.fun API',
  });
});

// Auth (login/register/session) is handled directly by Supabase Auth in the
// frontend, so there is no /api/auth route. These data routes forward the
// caller's Supabase JWT to Supabase (see middleware/requireAuth.js).
app.use('/api/events', eventRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/profile', userRoutes);
app.use('/api/confirmation', confirmationRoutes);
app.use('/api/hosted-events', organiserRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/password-reset', passwordResetRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    route: req.originalUrl,
    status: 'not_found',
  });
});

// Surface async handler errors as JSON instead of crashing the process.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ status: 'error', message: err?.message ?? 'Internal server error.' });
});

const server = app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the other process or set API_PORT to a free port.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
