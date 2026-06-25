import express from 'express';
import { postAdminCancel, getLicense, getLicensePdf } from '../controllers/adminController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.post('/events/:eventId/cancel', requireAuth, postAdminCancel);
router.get('/license', requireAuth, getLicense);
router.get('/license/pdf', requireAuth, getLicensePdf);

export default router;
