import express from 'express';
import adminRoutes from './routes/adminRoutes.js';
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
app.use('/api/dashboard', adminRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({
    route: req.originalUrl,
    status: 'not_found',
  });
});

app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
//? change needed?