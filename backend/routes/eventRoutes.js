import express from 'express';
import { getEvent, listEvents } from '../controllers/eventController.js';

const router = express.Router();

router.get('/', listEvents);
router.get('/:eventId', getEvent);

export default router;
