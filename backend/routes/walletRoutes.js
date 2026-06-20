import express from 'express';
import { getWallet, postSetupIntent, postCard, postTopup } from '../controllers/walletController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const router = express.Router();

router.get('/', requireAuth, getWallet);
router.post('/setup-intent', requireAuth, postSetupIntent);
router.post('/card', requireAuth, postCard);
router.post('/topup', requireAuth, postTopup);

export default router;
