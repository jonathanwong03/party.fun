import express from 'express';
import { getAnalytics, getRevenueForecast } from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getAnalytics);
router.get('/forecast/:eventId', requireAuth, getRevenueForecast);

export default router;
