import express from 'express';
import { getAnalytics } from '../controllers/analyticsController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getAnalytics);

export default router;
