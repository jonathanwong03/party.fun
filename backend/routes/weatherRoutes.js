import express from 'express';
import { getWeather } from '../controllers/weatherController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getWeather);

export default router;
