import express from 'express';
import { getAnalytics, getCalculator, saveCalculator } from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getAnalytics);
router.get('/calculator/:eventId', requireAuth, getCalculator);
router.put('/calculator/:eventId', requireAuth, saveCalculator);

export default router;
