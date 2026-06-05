import express from 'express';
import { cancelTicket, getProfile } from '../controllers/userController.js';

const router = express.Router();

router.get('/', getProfile);
router.post('/tickets/:eventId/cancel', cancelTicket);

export default router;
