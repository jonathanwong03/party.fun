import express from 'express';
import organiserRoutes from './routes/organiserRoutes.js';
import authRoutes from './routes/authRoutes.js';
import checkoutRoutes from './routes/checkoutRoutes.js';
import confirmationRoutes from './routes/confirmationRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import userRoutes from './routes/userRoutes.js';

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

app.use('/api/auth', authRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/profile', userRoutes);
app.use('/api/confirmation', confirmationRoutes);
app.use('/api/dashboard', organiserRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    route: req.originalUrl,
    status: 'not_found',
  });
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
