import { createPlaceholderHandler } from '../utils/apiPlaceholder.js';

const authNote = {
  note: 'Frontend-only mock auth for now. Real auth will be added later.',
};

export const getLogin = createPlaceholderHandler('login', authNote);
export const postLogin = createPlaceholderHandler('login', authNote);
export const getRegister = createPlaceholderHandler('register', authNote);
export const postRegister = createPlaceholderHandler('register', authNote);
export const getLogout = createPlaceholderHandler('logout', authNote);
export const postLogout = createPlaceholderHandler('logout', authNote);
