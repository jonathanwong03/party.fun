import express from 'express';
import {
  getLogin,
  getLogout,
  getRegister,
  postLogin,
  postLogout,
  postRegister,
  postReset,
} from '../controllers/authController.js';

const router = express.Router();

router.get('/login', getLogin);
router.post('/login', postLogin);
router.get('/register', getRegister);
router.post('/register', postRegister);
router.get('/logout', getLogout);
router.post('/logout', postLogout);
router.post('/reset', postReset);

export default router;
