import express from 'express';
import {
  getLogin,
  getLogout,
  getRegister,
  postLogin,
  postLogout,
  postRegister,
} from '../controllers/authController.js';

const router = express.Router();

router.get('/login', getLogin);
router.post('/login', postLogin);
router.get('/register', getRegister);
router.post('/register', postRegister);
router.get('/logout', getLogout);
router.post('/logout', postLogout);

export default router;
