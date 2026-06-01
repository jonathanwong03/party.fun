import express from 'express';
import { getConfirmation } from '../controllers/confirmationController.js';

const router = express.Router();

router.get('/:eventId', getConfirmation);

export default router;
